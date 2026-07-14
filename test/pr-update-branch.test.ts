import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const UPDATE_PATH = `${REPO_PATH}/pulls/9/update`;

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

function updateRequest() {
  return server.requests.find(
    (request) => request.method === "POST" && request.path === UPDATE_PATH,
  );
}

describe("pr update-branch", () => {
  it("updates the head branch with the default merge style", async () => {
    server = await startFixtureServer([{ method: "POST", path: UPDATE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(["pr", "update-branch", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("updated:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("status: ok");
    expect(updateRequest()?.query.style).toBe("merge");
  });

  it("passes --style rebase to the update endpoint", async () => {
    server = await startFixtureServer([{ method: "POST", path: UPDATE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(["pr", "update-branch", "9", "--style", "rebase"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("updated:");
    expect(updateRequest()?.query.style).toBe("rebase");
  });

  it("rejects an invalid --style value before any API call", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "update-branch", "9", "--style", "cherry"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "update-branch", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr update-branch");
    expect(server.requests).toHaveLength(0);
  });
});
