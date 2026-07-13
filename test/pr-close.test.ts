import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const PR_PATH = `${REPO_PATH}/pulls/9`;
const COMMENTS_PATH = `${REPO_PATH}/issues/9/comments`;

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("pr close", () => {
  it("closes an open pull request and reports the action", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "open" } },
      { method: "PATCH", path: PR_PATH, body: { number: 9, state: "closed" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "close", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("closed:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("status: ok");
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toEqual({ state: "closed" });
  });

  it("posts a --comment after the close and reports success", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "open" } },
      { method: "PATCH", path: PR_PATH, body: { number: 9, state: "closed" } },
      { method: "POST", path: COMMENTS_PATH, status: 201, body: { id: 1 } },
    ]);
    const { exitCode } = await runCliTest(["pr", "close", "9", "--comment", "Superseded."], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const post = server.requests.find((request) => request.method === "POST");
    expect(post?.body).toEqual({ body: "Superseded." });
    // The close lands before the comment.
    const patchIndex = server.requests.findIndex((request) => request.method === "PATCH");
    const postIndex = server.requests.findIndex((request) => request.method === "POST");
    expect(patchIndex).toBeLessThan(postIndex);
  });

  it("surfaces a comment-post failure even though the pull request was closed", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "open" } },
      { method: "PATCH", path: PR_PATH, body: { number: 9, state: "closed" } },
      { method: "POST", path: COMMENTS_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "close", "9", "--comment", "note"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    // The close still happened.
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(true);
  });

  it("returns early with already: true on an already-closed pull request", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "closed" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "close", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull_request:");
    expect(stdout).toContain("state: closed");
    expect(stdout).toContain("already: true");
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("reports a merged pull request as state: merged without patching", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PR_PATH, body: { number: 9, state: "closed", merged: true } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "close", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("state: merged");
    expect(stdout).toContain("already: true");
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "close", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr close");
    expect(server.requests).toHaveLength(0);
  });
});
