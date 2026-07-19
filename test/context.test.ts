import { afterEach, describe, expect, it } from "vitest";
import { resolveRepoContext } from "../src/context.js";
import type { CliDeps } from "../src/deps.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

let server: FixtureServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("context overrides", () => {
  it("prefers the -R flag over GITEA_AXI_REPO", async () => {
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/flagowner/flagrepo/issues", body: [] },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "list", "-R", "flagowner/flagrepo"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(server.requests[0]!.path).toBe("/api/v1/repos/flagowner/flagrepo/issues");
  });

  it("accepts -R before the command", async () => {
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/flagowner/flagrepo/issues", body: [] },
    ]);
    const { exitCode } = await runCliTest(
      ["-R", "flagowner/flagrepo", "issue", "list"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(server.requests[0]!.path).toBe("/api/v1/repos/flagowner/flagrepo/issues");
  });

  it("accepts the --repo=OWNER/NAME form", async () => {
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/flagowner/flagrepo/issues", body: [] },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "list", "--repo=flagowner/flagrepo"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(server.requests[0]!.path).toBe("/api/v1/repos/flagowner/flagrepo/issues");
  });

  it("includes the -R override in next-step suggestions when context came from a flag", async () => {
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/flagowner/flagrepo/issues", body: [] },
    ]);
    const { stdout } = await runCliTest(
      ["issue", "list", "-R", "flagowner/flagrepo"],
      { env: testModeEnv(server.url) },
    );

    expect(stdout).toContain("-R flagowner/flagrepo");
  });

  it("includes the -R override in suggestions when context came from the environment", async () => {
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/testowner/testrepo/issues", body: [] },
    ]);
    const { stdout } = await runCliTest(["issue", "list"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("-R testowner/testrepo");
  });

  it("fails with REPO_NOT_FOUND when test mode has no repository context", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { GITEA_AXI_API_URL: server.url, GITEA_AXI_TOKEN: "test-token" },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: REPO_NOT_FOUND");
    expect(stdout).toContain("GITEA_AXI_REPO");
  });

  it("rejects a malformed -R value with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "-R", "not-a-repo"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("OWNER/NAME");
  });

  it("rejects -R without a value with exit code 2", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list", "-R"], {
      env: { GITEA_AXI_API_URL: "http://127.0.0.1:1" },
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
  });

  it("test mode never spawns git or tea", async () => {
    // An empty PATH makes any subprocess spawn fail loudly; success here
    // proves the git and tea subprocesses were suppressed.
    server = await startFixtureServer([
      { method: "GET", path: "/api/v1/repos/testowner/testrepo/issues", body: [] },
    ]);
    const { exitCode } = await runCliTest(["issue", "list"], {
      env: { ...testModeEnv(server.url), PATH: "" },
    });

    expect(exitCode).toBe(0);
  });
});

describe("apiUrl normalization", () => {
  function depsWithApiUrl(apiUrl: string): CliDeps {
    return {
      env: {
        GITEA_AXI_API_URL: apiUrl,
        GITEA_AXI_REPO: "acme/widgets",
        GITEA_AXI_TOKEN: "test-token",
      },
      cwd: process.cwd(),
      globals: {},
    };
  }

  it("strips a trailing /api/v1 suffix from the host base", async () => {
    const context = await resolveRepoContext(
      depsWithApiUrl("https://git.example.com/api/v1"),
    );

    expect(context.apiUrl).toBe("https://git.example.com");
  });

  it("strips a trailing /api/v1/ with a trailing slash", async () => {
    const context = await resolveRepoContext(
      depsWithApiUrl("https://git.example.com/api/v1/"),
    );

    expect(context.apiUrl).toBe("https://git.example.com");
  });

  it("leaves a host base without an /api/v1 suffix unchanged", async () => {
    const context = await resolveRepoContext(
      depsWithApiUrl("https://git.example.com"),
    );

    expect(context.apiUrl).toBe("https://git.example.com");
  });

  it("strips a lone trailing slash from the host base", async () => {
    const context = await resolveRepoContext(
      depsWithApiUrl("https://git.example.com/"),
    );

    expect(context.apiUrl).toBe("https://git.example.com");
  });
});
