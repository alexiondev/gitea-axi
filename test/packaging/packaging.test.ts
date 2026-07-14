import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "../fixture-server.js";

// The one artifact under test: the packed npm tarball, installed globally into a
// throwaway prefix. Packing plus a global install is expensive and identical for
// every facet, so it is built once here and the four facets assert against the
// shared result.

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

let workDir: string;
let extractDir: string;
let binPath: string;
/** The manifest as it ships inside the packed tarball. */
let packedManifest: Record<string, unknown>;

// Unlike the in-process CLI-seam harness (test/harness.ts), which keeps the
// environment fully explicit so nothing leaks in, this tier spawns a real
// globally-installed binary as a subprocess. That subprocess genuinely needs the
// parent env (PATH to resolve node/npm/tar, npm config, etc.), so both helpers
// inherit `process.env` on purpose and layer the per-call `env` on top.

/** Run the globally installed binary, returning its stdout. */
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
  workDir = mkdtempSync(join(tmpdir(), "gitea-axi-pack-"));

  // Pack the real tarball. `npm pack --json` reports the tarball filename; the
  // shape shifted across npm majors (an array of entries on npm <12, an object
  // keyed by package name on npm 12+), so accept either and pull the one
  // filename out.
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", workDir],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const packResult = JSON.parse(packOutput) as unknown;
  const packEntries = Array.isArray(packResult)
    ? (packResult as Array<{ filename: string }>)
    : Object.values(packResult as Record<string, { filename: string }>);
  const tarball = join(workDir, packEntries[0]!.filename);

  // Extract to inspect the packed manifest and confirm bundled files. npm nests
  // everything under `package/`.
  extractDir = join(workDir, "extract");
  mkdirSync(extractDir);
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir]);
  packedManifest = JSON.parse(
    readFileSync(join(extractDir, "package", "package.json"), "utf8"),
  ) as Record<string, unknown>;

  // Install globally into a throwaway prefix so the binary lands on a PATH-like
  // bin dir we control.
  const prefix = join(workDir, "prefix");
  execFileSync("npm", ["install", "-g", "--prefix", prefix, tarball], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  binPath = join(prefix, "bin", "gitea-axi");
}, 300_000);

afterAll(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("npm distribution artifact", () => {
  it("bundles the built CLI, the bin entry, and the Agent Skill, and declares no postinstall", () => {
    expect(existsSync(join(extractDir, "package", "dist", "main.js"))).toBe(true);
    expect(existsSync(join(extractDir, "package", "skills", "gitea-axi", "SKILL.md"))).toBe(true);

    const bin = packedManifest.bin as Record<string, string> | undefined;
    expect(bin?.["gitea-axi"]).toBe("dist/main.js");

    const scripts = packedManifest.scripts as Record<string, string> | undefined;
    expect(scripts?.postinstall).toBeUndefined();
  });

  it("declares complete metadata: unscoped name, description, repo, license, engines, ESM type", () => {
    const name = packedManifest.name as string;
    expect(name).toBe("gitea-axi");
    expect(name).not.toContain("@");
    expect(name).not.toContain("/");

    const description = packedManifest.description as string;
    expect(typeof description).toBe("string");
    expect(description.length).toBeGreaterThan(0);

    const repository = packedManifest.repository as string | { url?: string } | undefined;
    const repositoryUrl = typeof repository === "string" ? repository : repository?.url;
    expect(repositoryUrl).toContain("gitea-axi");

    expect(packedManifest.license).toBe("MIT");

    const engines = packedManifest.engines as Record<string, string> | undefined;
    expect(engines?.node).toMatch(/20/);

    expect(packedManifest.type).toBe("module");
  });

  it("scripts and documents the publish flow so publishing is a single command", () => {
    const scripts = packedManifest.scripts as Record<string, string> | undefined;
    expect(scripts?.prepack).toBe("npm run build");

    const publishConfig = packedManifest.publishConfig as Record<string, string> | undefined;
    expect(publishConfig?.access).toBe("public");

    const publishingDoc = join(projectRoot, "PUBLISHING.md");
    expect(existsSync(publishingDoc)).toBe(true);
    expect(readFileSync(publishingDoc, "utf8")).toMatch(/npm publish/);
  });

  it("puts a working gitea-axi on the PATH: dashboard header, --help, and setup all function", async () => {
    expect(existsSync(binPath)).toBe(true);

    expect(run(["--help"])).toContain("usage: gitea-axi");

    // Dashboard header renders against a stubbed Gitea.
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

    // `setup` installs the Agent Skill into HOME/.claude.
    const home = mkdtempSync(join(tmpdir(), "gitea-axi-home-"));
    try {
      expect(run(["setup"], { HOME: home })).toContain("status: installed");
      expect(existsSync(join(home, ".claude", "skills", "gitea-axi", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
