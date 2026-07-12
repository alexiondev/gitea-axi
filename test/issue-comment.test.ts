import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, tempFiles, testModeEnv } from "./harness.js";

const COMMENTS_PATH = "/api/v1/repos/testowner/testrepo/issues/42/comments";

let server: FixtureServer;
const files = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

function createdComment(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 900,
    user: { login: "alexion" },
    created_at: "2026-07-01T00:00:00Z",
    body: "Looks good to me.",
    ...fields,
  };
}

function postedComment(): Record<string, unknown> {
  return postedBody(server, COMMENTS_PATH);
}

describe("issue comment", () => {
  it("posts the comment and renders number, author, created, and body", async () => {
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body", "Looks good to me."],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comment:");
    // `number` is the issue commented on, not the comment's own id.
    expect(stdout).toContain("number: 42");
    expect(stdout).toContain("author: alexion");
    expect(stdout).toContain("body: Looks good to me.");
    expect(stdout).not.toContain("900");
    expect(postedComment()).toEqual({ body: "Looks good to me." });
  });

  it("reads the body from --body-file", async () => {
    const path = files.write("comment.md", "From a file.");
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedComment()).toEqual({ body: "From a file." });
  });

  it("truncates a comment body over 800 chars in the output, with the inline hint", async () => {
    const body = "z".repeat(1000);
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment({ body }) },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body", body],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      `... (truncated, ${body.length} chars total - use --full to see complete body)`,
    );
    // The posted body itself is never truncated — only its echo in the output.
    expect(postedComment()).toEqual({ body });
  });

  it("echoes the untruncated body with --full", async () => {
    const body = "z".repeat(1000);
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment({ body }) },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body", body, "--full"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(body);
    expect(stdout).not.toContain("truncated");
  });

  it("cleans a long comment body before truncating it", async () => {
    const body = `See http://127.0.0.1/o/r/pulls/9 for context. ${"y".repeat(900)}`;
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment({ body }) },
    ]);
    const { stdout } = await runCliTest(["issue", "comment", "42", "--body", body], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("PR#9");
  });

  it("suggests viewing the thread when the target is an issue", async () => {
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment() },
    ]);
    const { stdout } = await runCliTest(["issue", "comment", "42", "--body", "hi"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("issue view 42 --comments");
  });

  it("accepts a pull request number without a type-guard error", async () => {
    server = await startFixtureServer([
      {
        method: "POST",
        path: COMMENTS_PATH,
        status: 201,
        body: createdComment({
          pull_request_url: "http://127.0.0.1/testowner/testrepo/pulls/42",
        }),
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body", "Looks good to me."],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("is a pull request");
    // The issue is never fetched, so a PR number simply flows through.
    expect(server.requests.every((request) => request.method === "POST")).toBe(true);
    // `issue view` type-guards PRs, so it must never be suggested for a PR
    // target — the suggestion would be a command guaranteed to fail.
    expect(stdout).not.toContain("issue view 42");
  });

  it("rejects a missing body before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "comment", "42"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--body");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a missing issue number before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "comment", "--body", "hi"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("reports a nonexistent issue as ISSUE_NOT_FOUND with exit 1", async () => {
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 404, body: { message: "Not Found" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", "42", "--body", "hi"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: ISSUE_NOT_FOUND");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "comment", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue comment <number>");
    expect(server.requests).toHaveLength(0);
  });
});
