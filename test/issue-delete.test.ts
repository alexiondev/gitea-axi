import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/7";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("issue delete", () => {
  it("deletes an issue and reports the deletion", async () => {
    server = await startFixtureServer([
      { method: "DELETE", path: ISSUE_PATH, status: 204 },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "delete", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("issue:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("status: deleted");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("refuses to delete a nonexistent issue with ISSUE_NOT_FOUND", async () => {
    server = await startFixtureServer([
      { method: "DELETE", path: ISSUE_PATH, status: 404, body: { message: "issue does not exist" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "delete", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: ISSUE_NOT_FOUND");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "delete", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue delete");
    expect(server.requests).toHaveLength(0);
  });
});
