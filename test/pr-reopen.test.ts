import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const PR_PATH = `${REPO_PATH}/pulls/9`;

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("pr reopen", () => {
  it("reopens a closed pull request and reports the action", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "closed" } },
      { method: "PATCH", path: PR_PATH, body: { number: 9, state: "open" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "reopen", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("reopened:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("status: ok");
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toEqual({ state: "open" });
  });

  it("returns early with already: true on an already-open pull request", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "open" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "reopen", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull_request:");
    expect(stdout).toContain("state: open");
    expect(stdout).toContain("already: true");
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "reopen", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr reopen");
    expect(server.requests).toHaveLength(0);
  });
});
