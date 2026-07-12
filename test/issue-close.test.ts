import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/7";
const COMMENTS_PATH = "/api/v1/repos/testowner/testrepo/issues/7/comments";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("issue close", () => {
  it("closes an open issue and reports the action", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
      { method: "PATCH", path: ISSUE_PATH, body: { number: 7, state: "closed" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "close", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("closed:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("status: ok");
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toEqual({ state: "closed" });
  });

  it("posts a --comment after the close and reports success", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
      { method: "PATCH", path: ISSUE_PATH, body: { number: 7, state: "closed" } },
      { method: "POST", path: COMMENTS_PATH, status: 201, body: { id: 1 } },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "close", "7", "--comment", "Fixed in main."],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const post = server.requests.find((request) => request.method === "POST");
    expect(post?.body).toEqual({ body: "Fixed in main." });
    // The close lands before the comment.
    const patchIndex = server.requests.findIndex((request) => request.method === "PATCH");
    const postIndex = server.requests.findIndex((request) => request.method === "POST");
    expect(patchIndex).toBeLessThan(postIndex);
  });

  it("surfaces a comment-post failure even though the issue was closed", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
      { method: "PATCH", path: ISSUE_PATH, body: { number: 7, state: "closed" } },
      { method: "POST", path: COMMENTS_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "close", "7", "--comment", "note"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    // The close still happened.
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(true);
  });

  it("returns early with Already closed on an already-closed issue", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "closed" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "close", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("message: Already closed");
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "close", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue close");
    expect(server.requests).toHaveLength(0);
  });
});
