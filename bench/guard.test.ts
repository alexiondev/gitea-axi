import { mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Arm } from "./result.js";
import { guardCommand, provisionArmBin } from "./guard.js";

/**
 * Behavior: each shell-driving arm's own allow-listed binary passes the guard.
 *
 * The (arm, command) pairs below are independent literals — the benchmark spec
 * and ADR 0016 fix which binary each arm drives — rather than values derived
 * from the module under test, so the assertion stays a genuine check.
 */
const allowedForOwnBinary: ReadonlyArray<{ arm: Arm; command: string }> = [
  { arm: "gitea-axi", command: "gitea-axi issue list --state open" },
  { arm: "tea", command: "tea issues list --output json" },
  { arm: "raw-api", command: "curl -s https://host/api/v1/repos/o/r/issues" },
];

/**
 * Behavior: a foreign binary — one belonging to a different arm — is denied.
 *
 * Only one binary is allow-listed per arm (ADR 0016), so driving another arm's
 * tool must be refused. Each pair is an independent literal: a shell-driving
 * arm paired with a command whose executable is a foreign binary.
 */
const foreignBinaryForArm: ReadonlyArray<{ arm: Arm; command: string; foreign: string }> = [
  { arm: "gitea-axi", command: "curl -s https://host/api/v1/repos", foreign: "curl" },
  { arm: "tea", command: "gitea-axi issue list", foreign: "gitea-axi" },
  { arm: "raw-api", command: "tea issues list --output json", foreign: "tea" },
];

/**
 * Behavior: an absolute-path invocation of a foreign binary is denied.
 *
 * Naming a foreign binary by absolute path sidesteps the curated PATH, so the
 * guard must still refuse it (ADR 0016). Each pair is an independent literal:
 * a shell-driving arm paired with an absolute-path invocation of another arm's
 * binary.
 */
const foreignAbsolutePathForArm: ReadonlyArray<{ arm: Arm; command: string }> = [
  { arm: "gitea-axi", command: "/usr/bin/curl -s https://host/api/v1/repos" },
  { arm: "tea", command: "/opt/bin/gitea-axi issue list" },
  { arm: "raw-api", command: "/usr/local/bin/tea issues list" },
];

/**
 * Behavior: an interpreter-based fetch attempt is denied.
 *
 * Reaching the API over HTTP through a language runtime's HTTP client is a
 * foreign path for every arm — including raw-api, whose only allowed binary is
 * curl, not an interpreter (ADR 0016). Each pair is an independent literal: a
 * shell-driving arm paired with an interpreter invocation that fetches over HTTP.
 */
const interpreterFetchForArm: ReadonlyArray<{ arm: Arm; command: string }> = [
  {
    arm: "gitea-axi",
    command: `python3 -c "import urllib.request as u; u.urlopen('https://host/api/v1')"`,
  },
  {
    arm: "tea",
    command: `node -e "fetch('https://host/api/v1').then(r => r.text())"`,
  },
  {
    arm: "raw-api",
    command: `ruby -e "require 'net/http'; Net::HTTP.get(URI('https://host/api/v1'))"`,
  },
];

describe("guardCommand", () => {
  it.each(allowedForOwnBinary)(
    "permits the $arm arm to run its own allow-listed binary",
    ({ arm, command }) => {
      expect(guardCommand(arm, command)).toEqual({ allowed: true });
    },
  );

  it.each(foreignBinaryForArm)(
    "denies the $arm arm a command driving the foreign binary $foreign",
    ({ arm, command, foreign }) => {
      const decision = guardCommand(arm, command);
      expect(decision.allowed).toBe(false);
      // A genuine foreign-binary denial names the offending binary in its reason,
      // distinguishing it from denial for some unrelated cause.
      if (decision.allowed === false) {
        expect(decision.reason).toContain(foreign);
      }
    },
  );

  it("denies a foreign binary reached downstream of a pipe, not only the leading command", () => {
    // The tea arm's own binary leads the line and is allow-listed, but a foreign
    // interpreter (python3) is reached after the pipe. The guard must inspect
    // every binary the command reaches, not just the first token.
    const decision = guardCommand("tea", 'tea issues list | python3 -c "import urllib.request"');

    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toContain("python3");
    }
  });

  it.each(foreignAbsolutePathForArm)(
    "denies the $arm arm a foreign binary named by absolute path",
    ({ arm, command }) => {
      const decision = guardCommand(arm, command);
      expect(decision.allowed).toBe(false);
    },
  );

  it.each(interpreterFetchForArm)(
    "denies the $arm arm an interpreter-based fetch over HTTP",
    ({ arm, command }) => {
      const decision = guardCommand(arm, command);
      expect(decision.allowed).toBe(false);
    },
  );

  // The gitea-mcp arm reaches Gitea only through its attached MCP tools; its shell
  // is disabled entirely, so no command — not even another arm's allow-listed
  // binary or a bare harmless utility — may run (ADR 0016). Independent literals.
  it.each([
    "gitea-axi issue list",
    "tea issues list",
    "curl https://host",
    "ls",
  ])("denies the gitea-mcp arm every shell command, including %j", (command) => {
    const decision = guardCommand("gitea-mcp", command);
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      // The denial is about the shell being off for this arm, not an ordinary
      // foreign-binary rejection.
      expect(decision.reason).toMatch(/shell/i);
    }
  });

  it("denies a foreign binary hidden inside a command substitution", () => {
    // The leading curl is allow-listed for raw-api, but python3 hides inside the
    // $(...) substitution. The guard must look inside substitutions, not just at
    // the top-level command.
    const decision = guardCommand(
      "raw-api",
      `curl -s $(python3 -c "print('https://host')")/api/v1/repos`,
    );

    expect(decision.allowed).toBe(false);
  });

  // The arm's own binary alongside curated harmless utilities (jq, head — which
  // cannot reach the network or execute code) is permitted, and shell plumbing
  // like a 2>&1 redirection must not be mistaken for a foreign command (ADR 0016).
  it.each([
    { arm: "raw-api" as Arm, command: "curl -s https://host/api/v1/repos 2>&1 | head -n 5" },
    { arm: "tea" as Arm, command: "tea issues list --output json | jq '.[].number'" },
  ])(
    "permits the $arm arm's binary piped through a curated read-only utility",
    ({ arm, command }) => {
      expect(guardCommand(arm, command)).toEqual({ allowed: true });
    },
  );

  it("permits a leading NAME=value assignment before the arm's binary", () => {
    // The runner passes the API token via a leading environment assignment; the
    // command is the binary that follows, not the assignment itself.
    expect(guardCommand("gitea-axi", "TOKEN=secret gitea-axi issue list")).toEqual({
      allowed: true,
    });
  });

  it("denies a path-qualified invocation of the arm's own binary", () => {
    // The curated PATH resolves the arm's binary by name; a path-qualified form
    // sidesteps that and could resolve to something else via a symlink or copy,
    // so it is refused even for the arm's own allow-listed binary.
    const decision = guardCommand("tea", "/usr/bin/tea issues list");

    expect(decision.allowed).toBe(false);
  });
});

describe("provisionArmBin", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "gitea-axi-armbin-"));
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  // Fake resolver so the test never depends on binaries present on the host.
  const locate = (binary: string) => `/fake/prefix/${binary}`;

  // Independent literals: each shell arm's one allow-listed binary (ADR 0016),
  // NOT read back from ARM_BINARY.
  const shellArmBinary: ReadonlyArray<{ arm: Arm; binary: string }> = [
    { arm: "gitea-axi", binary: "gitea-axi" },
    { arm: "tea", binary: "tea" },
    { arm: "raw-api", binary: "curl" },
  ];

  it.each(shellArmBinary)(
    "exposes only the $arm arm's allow-listed binary $binary as a symlink",
    ({ arm, binary }) => {
      provisionArmBin(arm, binDir, locate);

      expect(readdirSync(binDir)).toEqual([binary]);
      expect(readlinkSync(join(binDir, binary))).toBe(`/fake/prefix/${binary}`);
    },
  );

  it("exposes nothing for the gitea-mcp arm, whose shell is disabled", () => {
    provisionArmBin("gitea-mcp", binDir, locate);

    expect(readdirSync(binDir)).toEqual([]);
  });

  it("throws when the arm's binary cannot be located", () => {
    expect(() => provisionArmBin("tea", binDir, () => null)).toThrow(/tea/);
  });

  it("is idempotent across the trials of one sitting sharing a bin directory", () => {
    // A benchmark sitting runs several trials against one per-sitting bin
    // directory, so provisionArmBin is called once per trial on the same dir.
    // A repeat call must not throw and must leave a single symlink, not a
    // duplicate or a partially-clobbered link.
    expect(() => {
      provisionArmBin("gitea-axi", binDir, locate);
      provisionArmBin("gitea-axi", binDir, locate);
    }).not.toThrow();

    expect(readdirSync(binDir)).toEqual(["gitea-axi"]);
    expect(readlinkSync(join(binDir, "gitea-axi"))).toBe("/fake/prefix/gitea-axi");
  });
});
