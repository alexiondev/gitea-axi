import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/7";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("issue reopen", () => {
  it("reopens a closed issue and reports the action", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "closed" } },
      { method: "PATCH", path: ISSUE_PATH, body: { number: 7, state: "open" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "reopen", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("reopened:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("status: ok");
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toEqual({ state: "open" });
  });

  it("returns early with Already open on an already-open issue", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "reopen", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("message: Already open");
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "reopen", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue reopen");
    expect(server.requests).toHaveLength(0);
  });
});
