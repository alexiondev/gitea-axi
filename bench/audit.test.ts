import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildArm, type SharedContext } from "./arm.js";
import { auditTranscript, type ToolUse } from "./audit.js";

/**
 * The shared context handed to every arm. Its values are distinctive literals so
 * that they are unambiguous in any assertion, independent of the module under
 * test — mirrors the fixture in arm.test.ts.
 */
const context: SharedContext = {
  coords: { owner: "acme", repo: "bench-xyz" },
  access: { apiUrl: "https://git.example.test", token: "s3cr3t-token" },
};

// Fake resolver so building an arm never depends on binaries present on the
// host; dangling symlinks in the curated bin dir are fine (see arm.test.ts).
const locate = (binary: string) => `/fake/bin/${binary}`;

describe("auditTranscript", () => {
  let binRoot: string;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), "bench-audit-"));
  });

  afterEach(() => {
    rmSync(binRoot, { recursive: true, force: true });
  });

  // Behavior: a shell-driving arm whose transcript reaches only its own
  // allow-listed binary and curated harmless utilities audits clean — nothing
  // leaked (benchmark-harness spec, "Tool isolation"). The tea arm's allowed
  // binary is `tea`, and `grep` is a curated harmless utility (guard.ts's
  // ARM_BINARY / HARMLESS_BINARIES) — independent literals fixed by the guard's
  // contract, not recomputed from the audit implementation. The expected verdict
  // is therefore a clean result with no leaks.
  it("passes a tea-arm transcript of only its own binary and harmless utilities as clean", () => {
    const arm = buildArm("tea", context, { binRoot, locate });
    const transcript: ToolUse[] = [
      { kind: "shell", command: "tea issues list" },
      { kind: "shell", command: "tea issues list | grep bug" },
    ];

    const result = auditTranscript(arm, transcript);

    expect(result.clean).toBe(true);
  });

  // Behavior: a run in which a foreign tool was reached is flagged invalid
  // instead of scored — the transcript audits as a leak (benchmark-harness spec,
  // "Tool isolation"). On the tea arm, `curl` is a network tool the guard denies
  // (it is explicitly excluded from guard.ts's HARMLESS_BINARIES), so a
  // transcript that reaches it is NOT clean and reports at least one leak. `curl`
  // being foreign to the tea arm is an independent literal fixed by the guard's
  // contract, not recomputed from the audit implementation.
  it("flags a tea-arm transcript that reaches a foreign binary as a leak", () => {
    const arm = buildArm("tea", context, { binRoot, locate });
    const transcript: ToolUse[] = [
      { kind: "shell", command: "tea issues list" },
      { kind: "shell", command: "curl https://git.example.test/api/v1/repos/acme/bench-xyz/issues" },
    ];

    const result = auditTranscript(arm, transcript);

    expect(result.clean).toBe(false);
    if (!result.clean) {
      expect(result.leaks.length).toBeGreaterThan(0);
    }
  });

  // Behavior: the gitea-mcp arm runs with the shell disabled — it reaches Gitea
  // only through its attached MCP tools (guard.ts's ARM_BINARY is null for it,
  // arm.ts leaves its ArmDefinition.shell null). So any shell command in a
  // gitea-mcp transcript means the shell was reached on a shell-disabled arm,
  // which is a leak, while a genuine MCP tool call on this arm is legitimate. The
  // load-bearing verdict is NOT clean with at least one leak, fixed by the
  // arm/guard contract rather than the audit implementation. A legitimate mcp
  // entry is included to show it is the shell entry — not the mcp entry — that
  // leaks.
  it("flags a shell command on the shell-disabled gitea-mcp arm as a leak", () => {
    const arm = buildArm("gitea-mcp", context, { binRoot, locate });
    const transcript: ToolUse[] = [
      { kind: "mcp", server: "gitea-mcp", tool: "list_repo_issues" },
      { kind: "shell", command: "tea issues list" },
    ];

    const result = auditTranscript(arm, transcript);

    expect(result.clean).toBe(false);
    if (!result.clean) {
      expect(result.leaks.length).toBeGreaterThan(0);
    }
  });
});
