// The production agent driver: the adapter that runs one arm through the Claude
// Agent SDK on the maintainer's subscription and reports the metrics and
// transcript the runner records. It is the concrete `AgentDriver` behind the seam
// the runner depends on; the deterministic runner tests inject a fake instead, and
// this live wiring is exercised only by the smoke run.
//
// The Agent SDK is loaded through a computed dynamic import so the harness's
// deterministic tier and the project's typecheck never require the package to be
// installed — the SDK is needed only for live runs, exactly as the seed smoke tier
// needs a live Gitea host. A local interface describes the slice of the SDK this
// adapter consumes, so this side of the boundary stays type-checked even though the
// package is optional.
//
// Isolation is enforced in-band via the SDK's permission callback: every Bash
// command on a shell arm is put through the arm's own guard, and the shell is
// disabled entirely on the MCP arm. Only tools that were permitted to run are
// recorded in the transcript, so the runner's post-run audit sees what actually
// executed — a blocked attempt is realistic wasted effort, not a leak.

import type { ArmDefinition } from "./arm.js";
import { foreignToolReason, type ToolUse } from "./audit.js";
import type { TokenComponents } from "./result.js";
import type { AgentDriver, AgentRun, AgentRunInput } from "./runner.js";

/** The default fixed model every arm is run on (overridable for the whole run). */
const DEFAULT_MODEL = "claude-opus-4-8";

/** The Agent SDK package, resolved at run time so it is an optional peer of the harness. */
const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/** Configuration for the SDK-backed driver. */
export interface SdkDriverConfig {
  /** The single fixed model all arms run on. Defaults to the latest Opus. */
  model?: string;
  /** Override the SDK module specifier (tests/tooling); defaults to the real package. */
  moduleSpecifier?: string;
}

// --- The slice of the Claude Agent SDK this adapter consumes ------------------

/**
 * Per-model token usage as the SDK's `modelUsage` reports it, one entry per model
 * the run touched. The SDK reports these in camelCase — distinct from the aggregate
 * {@link SdkUsage} below, which it reports in the Anthropic API's snake_case shape.
 * Reading the wrong casing silently yields zeros, so the two are kept separate.
 */
interface SdkModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** The aggregate per-request usage (snake_case), the fallback when no per-model breakdown is present. */
interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface SdkResultMessage {
  type: "result";
  /** `error_max_turns` when the run hit the turn cap. */
  subtype: string;
  usage?: SdkUsage;
  /** Per-model usage, including the auxiliary small model the runtime invokes. */
  modelUsage?: Record<string, SdkModelUsage>;
  total_cost_usd?: number;
  num_turns?: number;
  result?: string;
}

interface SdkContentBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface SdkAssistantMessage {
  type: "assistant";
  message: { content: SdkContentBlock[] };
}

type SdkMessage = SdkResultMessage | SdkAssistantMessage | { type: string };

type SdkPermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

interface SdkStdioServer {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface SdkQueryOptions {
  model: string;
  /** Fixed at zero across every arm so runs are as deterministic as the model allows. */
  temperature: number;
  systemPrompt: string;
  maxTurns: number;
  abortController: AbortController;
  canUseTool: (toolName: string, input: Record<string, unknown>) => Promise<SdkPermissionResult>;
  settingSources: string[];
  env?: Record<string, string | undefined>;
  mcpServers?: Record<string, SdkStdioServer>;
  disallowedTools?: string[];
}

interface SdkModule {
  query: (args: { prompt: string; options: SdkQueryOptions }) => AsyncIterable<SdkMessage>;
}

// --- Metric and transcript extraction ----------------------------------------

/**
 * Sum the four token components across every model the run touched, so the
 * auxiliary small model the runtime invokes is folded in as the metric spec
 * requires. The per-model `modelUsage` (camelCase) is the primary source; the
 * aggregate `usage` (snake_case) is the fallback when no per-model breakdown is
 * present. The two shapes use different field casing, so each is read with its
 * own names — reading the wrong casing is what silently produced zero tokens.
 */
export function sumTokens(result: SdkResultMessage): TokenComponents {
  const total: TokenComponents = { freshInput: 0, cacheCreation: 0, cacheRead: 0, output: 0 };

  const perModel = result.modelUsage ? Object.values(result.modelUsage) : [];
  if (perModel.length > 0) {
    for (const usage of perModel) {
      total.freshInput += usage.inputTokens ?? 0;
      total.cacheCreation += usage.cacheCreationInputTokens ?? 0;
      total.cacheRead += usage.cacheReadInputTokens ?? 0;
      total.output += usage.outputTokens ?? 0;
    }
    return total;
  }

  if (result.usage) {
    total.freshInput += result.usage.input_tokens ?? 0;
    total.cacheCreation += result.usage.cache_creation_input_tokens ?? 0;
    total.cacheRead += result.usage.cache_read_input_tokens ?? 0;
    total.output += result.usage.output_tokens ?? 0;
  }
  return total;
}

/** Classify one tool invocation into the isolation-relevant shape the audit consumes. */
function classifyTool(toolName: string, input: Record<string, unknown>): ToolUse {
  if (toolName === "Bash") {
    return { kind: "shell", command: String(input.command ?? "") };
  }
  if (toolName.startsWith("mcp__")) {
    const [, server = "", tool = ""] = toolName.split("__");
    return { kind: "mcp", server, tool };
  }
  return { kind: "other", name: toolName };
}

/**
 * Build the SDK-backed agent driver. Each run drives one arm through the Agent
 * SDK: the arm's assembled system prompt, the task intent as the user prompt, the
 * fixed model, the turn cap as `maxTurns`, and the arm's tool configuration —
 * either its curated shell PATH with the guard on the permission callback, or the
 * MCP server attached with the shell disabled. The run is wired to the runner's
 * abort signal so the wall-clock backstop can stop it.
 */
export function sdkAgentDriver(config: SdkDriverConfig = {}): AgentDriver {
  const model = config.model ?? DEFAULT_MODEL;
  const specifier = config.moduleSpecifier ?? SDK_MODULE;

  return {
    async run(input: AgentRunInput): Promise<AgentRun> {
      const { query } = (await import(specifier)) as SdkModule;

      const controller = new AbortController();
      if (input.signal.aborted) {
        controller.abort();
      } else {
        input.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      // The transcript records only tools that were permitted to run, so the
      // runner's audit sees what actually executed, not blocked attempts.
      const transcript: ToolUse[] = [];
      const canUseTool = async (
        toolName: string,
        toolInput: Record<string, unknown>,
      ): Promise<SdkPermissionResult> => {
        const use = classifyTool(toolName, toolInput);
        const denial = foreignToolReason(input.arm, use);
        if (denial !== null) {
          return { behavior: "deny", message: denial };
        }
        transcript.push(use);
        return { behavior: "allow", updatedInput: toolInput };
      };

      const options = buildOptions(input.arm, model, input.turnCap, controller, canUseTool);

      let result: SdkResultMessage | undefined;
      for await (const message of query({ prompt: input.intent, options })) {
        if (message.type === "result") {
          result = message as SdkResultMessage;
        }
      }
      if (result === undefined) {
        throw new Error("the Agent SDK produced no result message");
      }

      return {
        tokens: sumTokens(result),
        turns: result.num_turns ?? 0,
        imputedCostUsd: result.total_cost_usd ?? 0,
        transcript,
        finalReport: result.result ?? "",
        stoppedByTurnCap: result.subtype === "error_max_turns",
      };
    },
  };
}

/** Assemble the SDK query options for an arm's tool configuration. */
function buildOptions(
  arm: ArmDefinition,
  model: string,
  turnCap: number,
  controller: AbortController,
  canUseTool: SdkQueryOptions["canUseTool"],
): SdkQueryOptions {
  const options: SdkQueryOptions = {
    model,
    // Temperature zero across all arms, per the runner-and-metrics spec, so the
    // comparison measures the tool rather than sampling noise.
    temperature: 0,
    systemPrompt: arm.systemPrompt,
    maxTurns: turnCap,
    abortController: controller,
    canUseTool,
    // Start from a clean slate: no user/project settings leak tools or config
    // into the measured run.
    settingSources: [],
  };
  if (arm.shell !== null) {
    // Lead the agent's PATH with the arm's curated bin directory so only its one
    // allowed binary resolves by name; the guard on canUseTool is the authority.
    options.env = { ...process.env, PATH: arm.shell.path };
  }
  if (arm.mcp !== null) {
    options.mcpServers = { [arm.arm]: { type: "stdio", ...arm.mcp.server } };
    options.disallowedTools = ["Bash"];
  }
  return options;
}
