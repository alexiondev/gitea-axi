// Per-arm scaffolding: the single arm definition the runner consumes for one
// cell. Every arm shares one task-agnostic base prompt and the same repository
// coordinates and token; each arm then receives a minimal, symmetric bootstrap
// naming its tool and pointing at that tool's own native discovery affordance.
//
// The deliberate asymmetries follow the shipped products (see the benchmark
// spec's Scaffolding section): the gitea-axi arm loads the bundled Agent Skill,
// because the Skill ships with the product and its token cost belongs to
// gitea-axi; the tea and raw-api arms get a one-line native-discovery pointer;
// the gitea-mcp arm's dispatcher schemas load eagerly as its ambient cost and it
// runs with the shell disabled, attaching only the MCP tools.
//
// This module assembles the prompt and composes the guard (guard.ts) for the
// tool/PATH configuration; it does not run the agent — the runner (a later
// slice) consumes an ArmDefinition and drives the Claude Agent SDK.

import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { guardCommand, provisionArmBin, type GuardDecision } from "./guard.js";
import type { Arm } from "./result.js";
import type { BenchAccess, RepoCoords } from "./seed.js";

/**
 * The task-agnostic inputs handed identically to every arm of a cell: the
 * throwaway repository's coordinates and the host access (base URL and token).
 */
export interface SharedContext {
  coords: RepoCoords;
  access: BenchAccess;
}

/**
 * The tool/PATH configuration for a shell-driving arm, derived from the guard.
 * `null` on an ArmDefinition marks an arm that runs with the shell disabled.
 */
export interface ArmShell {
  /** Curated bin directory exposing only the arm's one allowed binary. */
  binDir: string;
  /** PATH value: the curated bin dir prepended to the ambient PATH. */
  path: string;
  /** The authoritative tool-isolation guard, bound to this arm. */
  guard: (command: string) => GuardDecision;
}

/**
 * The MCP attachment for the gitea-mcp arm. The runner launches the server over
 * stdio and attaches its dispatcher tools, whose schemas load eagerly on connect
 * as the arm's ambient cost. `null` on an ArmDefinition marks an arm that reaches
 * Gitea through the shell instead.
 */
export interface ArmMcp {
  server: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

/**
 * Everything the runner needs to run one arm: the fully assembled system prompt
 * and the tool configuration. Exactly one of `shell` / `mcp` is non-null.
 */
export interface ArmDefinition {
  arm: Arm;
  systemPrompt: string;
  shell: ArmShell | null;
  mcp: ArmMcp | null;
}

/** Options controlling how an arm is built; the runner supplies a trial scratch dir. */
export interface BuildArmOptions {
  /** Directory under which the arm's curated bin dir is created (shell arms). */
  binRoot: string;
  /** Resolver for a binary's absolute path; injectable for host-independent tests. */
  locate?: (binary: string) => string | null;
  /** Override the bundled skill file's path (defaults to the shipped SKILL.md). */
  skillPath?: string;
}

/**
 * The identical, task-agnostic base prompt every arm's assembled prompt begins
 * with. It carries only the facts shared by all arms — the repository
 * coordinates, the host URL, and the token — and never names a specific tool or
 * task, so the base is byte-for-byte the same across arms and the per-arm
 * bootstrap is the only difference in the assembled prompt.
 */
export function basePrompt(context: SharedContext): string {
  const { owner, repo } = context.coords;
  const { apiUrl, token } = context.access;
  return [
    "You are a coding agent operating on a single Gitea repository.",
    "",
    `Repository: ${owner}/${repo}`,
    `Gitea host: ${apiUrl}`,
    `Access token: ${token}`,
    "",
    "Authenticate every request with that token, and confine your work to that",
    "repository. When the task asks a question, state your final answer plainly.",
  ].join("\n");
}

/**
 * The bundled Agent Skill's shipped location, resolved relative to this module
 * the same way the product resolves it (see src/commands/setup.ts's
 * `SKILL_SOURCE`). bench/ runs from source, so `import.meta.url` points at this
 * file and `../skills/...` lands at the repository's shipped skill.
 */
const DEFAULT_SKILL_PATH = new URL("../skills/gitea-axi/SKILL.md", import.meta.url);

/**
 * Read the bundled Agent Skill's body, stripping its YAML frontmatter. Only the
 * instructional body is charged to the gitea-axi arm: the frontmatter's
 * `description` is metadata Claude Code loads ambiently for every skill, so
 * folding it in here would double-count it against this one arm.
 */
function loadSkillBody(skillPath: string | URL): string {
  const raw = readFileSync(skillPath, "utf8");
  const match = raw.match(/^---\n[\s\S]*?\n---\n/);
  return (match ? raw.slice(match[0].length) : raw).trim();
}

/**
 * The per-arm bootstrap appended after the shared base: the minimal, symmetric
 * text naming the arm's tool and pointing at its native discovery affordance.
 * The gitea-axi arm is the deliberate asymmetry — it embeds the bundled Agent
 * Skill, whose token cost belongs to the shipped product.
 */
function armBootstrap(arm: Arm, context: SharedContext, options: BuildArmOptions): string {
  switch (arm) {
    case "gitea-axi": {
      const skill = loadSkillBody(options.skillPath ?? DEFAULT_SKILL_PATH);
      return [
        "You have the `gitea-axi` CLI available in your shell. Its bundled Agent",
        "Skill follows; treat it as your guide to the tool.",
        "",
        skill,
      ].join("\n");
    }
    case "tea":
      return "You have the `tea` CLI available in your shell; run `tea --help` to discover its commands.";
    case "raw-api":
      return `You have \`curl\` available in your shell; the Gitea REST API is documented at ${context.access.apiUrl}/api/swagger.`;
    case "gitea-mcp":
      return "The Gitea MCP server's tools are attached; use them to operate on the repository.";
  }
}

/**
 * The MCP attachment for the gitea-mcp arm: the official server launched over
 * stdio, pointed at the shared host and token through the environment variables
 * it reads (`GITEA_HOST`, `GITEA_ACCESS_TOKEN`). Attaching it is what loads the
 * dispatcher schemas eagerly — the SDK lists the server's tools on connect — so
 * that ambient cost is charged to this arm.
 */
function mcpAttachment(context: SharedContext): ArmMcp {
  return {
    server: {
      command: "gitea-mcp",
      args: ["-t", "stdio"],
      env: {
        GITEA_HOST: context.access.apiUrl,
        GITEA_ACCESS_TOKEN: context.access.token,
      },
    },
  };
}

/**
 * Build the tool/PATH configuration for a shell-driving arm from the guard:
 * provision a curated bin directory exposing only the arm's one allowed binary,
 * lead the PATH with it, and bind the authoritative guard to the arm. The
 * gitea-mcp arm has no shell binary (`provisionArmBin` exposes nothing for it),
 * so this returns null there and the arm reaches Gitea through its MCP tools.
 */
function buildShell(arm: Arm, options: BuildArmOptions): ArmShell | null {
  if (arm === "gitea-mcp") {
    return null;
  }
  const binDir = join(options.binRoot, arm);
  provisionArmBin(arm, binDir, options.locate);
  const ambient = process.env.PATH ?? "";
  return {
    binDir,
    path: ambient === "" ? binDir : `${binDir}${delimiter}${ambient}`,
    guard: (command) => guardCommand(arm, command),
  };
}

/** Assemble the single arm definition the runner consumes for the given arm. */
export function buildArm(arm: Arm, context: SharedContext, options: BuildArmOptions): ArmDefinition {
  const systemPrompt = `${basePrompt(context)}\n\n${armBootstrap(arm, context, options)}`;
  return {
    arm,
    systemPrompt,
    shell: buildShell(arm, options),
    mcp: arm === "gitea-mcp" ? mcpAttachment(context) : null,
  };
}
