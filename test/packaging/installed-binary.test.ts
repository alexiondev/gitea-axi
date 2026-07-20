import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "../fixture-server.js";
import { installGlobally, packTarball } from "./npm-artifact.js";

// What an *installed* gitea-axi must do, whatever installed it: run, render
// against a Gitea, and install its Agent Skill.
//
// The binary under test comes from the environment when GITEA_AXI_INSTALLED_BIN
// names one, and otherwise from packing and globally installing the npm tarball
// right here. That makes this one seam with two callers — the npm distribution
// path and the Nix installation path — so the two cannot drift apart in what
// they guarantee.
//
// Consequently nothing below may assert on how the binary came to exist: no
// store paths, no wrapper internals, no arrangement of files within the
// installed tree. Those are implementation detail of the installation method.

/**
 * Set by a caller that has already installed gitea-axi and wants that one
 * driven. An empty value counts as unset, so exporting it blank is the same as
 * not exporting it at all.
 */
const providedBin = process.env.GITEA_AXI_INSTALLED_BIN || undefined;

let workDir: string | undefined;
let binPath: string;

// Unlike the in-process CLI-seam harness (test/harness.ts), which keeps the
// environment fully explicit so nothing leaks in, this tier spawns a real
// installed binary as a subprocess. That subprocess genuinely needs the parent
// env (PATH to resolve node/git/tea, npm config, etc.), so both helpers inherit
// `process.env` on purpose and layer the per-call `env` on top.

/** Run the installed binary, returning its stdout. */
function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync(binPath, args, { encoding: "utf8", env: { ...process.env, ...env } });
}

const execFileAsync = promisify(execFile);

/**
 * Run the installed binary without blocking this process's event loop, so an
 * in-process fixture server can answer the CLI's HTTP calls while it runs. (A
 * synchronous `execFileSync` would freeze the loop the fixture server lives on,
 * deadlocking the request/response.)
 */
async function runAsync(args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync(binPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return stdout;
}

beforeAll(() => {
  if (providedBin !== undefined) {
    // Fail here rather than letting every assertion fail on a confusing ENOENT
    // from the spawn.
    if (!existsSync(providedBin)) {
      throw new Error(
        `GITEA_AXI_INSTALLED_BIN points at ${providedBin}, which does not exist. ` +
          "Unset it to have this tier pack and install the npm tarball itself.",
      );
    }
    binPath = providedBin;
    return;
  }

  workDir = mkdtempSync(join(tmpdir(), "gitea-axi-install-"));
  binPath = installGlobally(packTarball(workDir), workDir);
}, 300_000);

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("installed gitea-axi binary", () => {
  it("is executable and prints its usage", () => {
    expect(existsSync(binPath)).toBe(true);
    expect(run(["--help"])).toContain("usage: gitea-axi");
  });

  it("renders the dashboard header against a Gitea", async () => {
    const server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/o/r/pulls", body: [] },
      { method: "GET", path: "/api/v1/repos/o/r/issues", body: [] },
    ]);
    try {
      const dashboard = await runAsync([], {
        GITEA_AXI_API_URL: server.url,
        GITEA_AXI_REPO: "o/r",
        GITEA_AXI_TOKEN: "x",
      });
      expect(dashboard).toContain("bin:");
      expect(dashboard).toContain("description: Agent-ergonomic CLI for Gitea");
      expect(dashboard).toContain("repo: o/r");
    } finally {
      await server.close();
    }
  });

  it("finds its bundled Agent Skill and installs it into HOME/.claude", () => {
    const home = mkdtempSync(join(tmpdir(), "gitea-axi-home-"));
    try {
      expect(run(["setup"], { HOME: home })).toContain("status: installed");
      expect(existsSync(join(home, ".claude", "skills", "gitea-axi", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
