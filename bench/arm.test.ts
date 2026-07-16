import { mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Arm } from "./result.js";
import { basePrompt, buildArm, type SharedContext } from "./arm.js";

/**
 * The shared context every arm is handed. Its values are distinctive literals so
 * that finding them echoed back in a prompt is unambiguous evidence, not a
 * coincidence — the coordinates ("acme/bench-xyz"), the host URL, and the token
 * are all chosen here, independent of the module under test.
 */
const context: SharedContext = {
  coords: { owner: "acme", repo: "bench-xyz" },
  access: { apiUrl: "https://git.example.test", token: "s3cr3t-token" },
};

/** Every arm the benchmark compares (ADR / result.ts); an independent literal list. */
const allArms: ReadonlyArray<Arm> = ["gitea-axi", "tea", "gitea-mcp", "raw-api"];

describe("basePrompt", () => {
  // Behavior: the task-agnostic base prompt carries the same repository
  // coordinates, host URL, and token the harness was given — these are the facts
  // every arm must share (benchmark-harness spec, "Scaffolding").
  it("echoes the repository coordinates, host URL, and token from the context", () => {
    const prompt = basePrompt(context);

    expect(prompt).toContain("acme/bench-xyz");
    expect(prompt).toContain("https://git.example.test");
    expect(prompt).toContain("s3cr3t-token");
  });
});

describe("buildArm", () => {
  let binRoot: string;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), "bench-arm-"));
  });

  afterEach(() => {
    rmSync(binRoot, { recursive: true, force: true });
  });

  // Fake resolver so provisioning a curated bin dir never depends on binaries
  // present on the host; dangling symlinks are fine.
  const locate = (binary: string) => `/fake/bin/${binary}`;

  // Behavior: all arms share the identical base prompt — the base is a common
  // prefix of every arm's system prompt, and arms differ only in the bootstrap
  // appended after it. The expected prefix is basePrompt(context), computed
  // independently of buildArm.
  it.each(allArms)(
    "prefixes the %s arm's system prompt with the identical shared base prompt",
    (arm) => {
      const base = basePrompt(context);
      const definition = buildArm(arm, context, { binRoot, locate });

      expect(definition.systemPrompt.startsWith(base)).toBe(true);
    },
  );

  // Behavior: the gitea-axi arm's assembled context carries the bundled Agent
  // Skill, because the Skill ships with the product and its token cost is charged
  // to gitea-axi (benchmark-harness spec, "Scaffolding"). "agent-ergonomic CLI"
  // is a distinctive phrase from the shipped skills/gitea-axi/SKILL.md body — an
  // independent literal anchor, not a value recomputed from the module.
  it("carries the bundled Agent Skill in the gitea-axi arm's system prompt", () => {
    const definition = buildArm("gitea-axi", context, { binRoot, locate });

    expect(definition.systemPrompt).toContain("agent-ergonomic CLI");
  });

  // Behavior: the tea and raw-API arms each receive only a one-line
  // native-discovery pointer beyond the shared base — unlike gitea-axi (whole
  // skill) or gitea-mcp (eager schemas) (benchmark-harness spec, "Scaffolding").
  // The bootstrap is the systemPrompt with the shared base prefix removed. Each
  // pointer must be a single line and name that arm's own tool. The tool names
  // ("tea", "curl" — raw-api drives the API via curl, ADR 0016) are independent
  // literals fixed by the spec, not recomputed from the module.
  it.each([
    { arm: "tea" as Arm, tool: "tea" },
    { arm: "raw-api" as Arm, tool: "curl" },
  ])(
    "gives the $arm arm only a one-line native-discovery pointer naming $tool",
    ({ arm, tool }) => {
      const definition = buildArm(arm, context, { binRoot, locate });
      const bootstrap = definition.systemPrompt.slice(basePrompt(context).length).trim();

      expect(bootstrap.split("\n")).toHaveLength(1);
      expect(bootstrap).toContain(tool);
    },
  );

  // Behavior: the gitea-mcp arm is MCP-only — its shell tool is disabled and only
  // the MCP tools are attached, reaching the same host and token as the shared
  // context (benchmark-harness spec, "Tool isolation" / "Scaffolding"). Eager
  // schema loading is inherent to attaching the MCP server, so the observable
  // facts are: no shell config, an attached MCP server, and that server's env
  // carrying the fixture's host URL and token (independent literals, not read
  // from the module). Env-var KEY names are deliberately not asserted, so the
  // test does not couple to launch-detail naming.
  it("makes the gitea-mcp arm MCP-only: shell disabled, MCP attached with the shared host and token", () => {
    const definition = buildArm("gitea-mcp", context, { binRoot, locate });

    expect(definition.shell).toBeNull();
    expect(definition.mcp).not.toBeNull();

    const envValues = Object.values(definition.mcp!.server.env);
    expect(envValues).toContain("https://git.example.test");
    expect(envValues).toContain("s3cr3t-token");
  });

  // Behavior: each non-MCP arm's tool/PATH configuration comes from the guard and
  // exposes only that arm's allowed binary (benchmark-harness spec, "Tool
  // isolation" / ADR 0016). The (arm, binary) pairs are independent literals —
  // ADR 0016 fixes exactly one allowed binary per shell arm — not values read
  // back from the module. For each shell arm: it is not an MCP arm; its curated
  // bin dir exposes only its own binary (symlinked to the injected target); its
  // PATH leads with that curated dir; and its guard permits its own binary while
  // denying a foreign one.
  const shellArms = [
    { arm: "gitea-axi", binary: "gitea-axi", foreign: "tea issues list" },
    { arm: "tea", binary: "tea", foreign: "curl https://x" },
    { arm: "raw-api", binary: "curl", foreign: "tea issues list" },
  ] as const;

  it.each(shellArms)(
    "configures the $arm arm's PATH and guard from the guard, exposing only $binary",
    ({ arm, binary, foreign }) => {
      const definition = buildArm(arm, context, { binRoot, locate });

      expect(definition.mcp).toBeNull();
      const shell = definition.shell;
      expect(shell).not.toBeNull();
      if (shell === null) return;

      // Curated bin dir exposes ONLY this arm's allowed binary, symlinked to the
      // injected resolver's target.
      expect(readdirSync(shell.binDir)).toEqual([binary]);
      expect(readlinkSync(join(shell.binDir, binary))).toBe(`/fake/bin/${binary}`);

      // PATH leads with the curated dir, so the arm's binary is found there first.
      expect(shell.path.split(":")[0]).toBe(shell.binDir);

      // The guard is bound to this arm: its own binary passes, a foreign one is denied.
      expect(shell.guard(`${binary} --help`).allowed).toBe(true);
      expect(shell.guard(foreign).allowed).toBe(false);
    },
  );
});
