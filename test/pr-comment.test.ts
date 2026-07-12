import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, tempFiles, testModeEnv } from "./harness.js";

// Pull request comments go through the shared issue-comment endpoint.
const COMMENTS_PATH = "/api/v1/repos/testowner/testrepo/issues/12/comments";

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
    pull_request_url: "http://127.0.0.1/testowner/testrepo/pulls/12",
    ...fields,
  };
}

function postedComment(): Record<string, unknown> {
  return postedBody(server, COMMENTS_PATH);
}

describe("pr comment", () => {
  it("posts the comment and renders number, author, created, and body", async () => {
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "comment", "12", "--body", "Looks good to me."],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    // The same `comment` block name as `issue comment`, per ADR 0008.
    expect(stdout).toContain("comment:");
    // `number` is the PR commented on, not the comment's own id.
    expect(stdout).toContain("number: 12");
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
    const { exitCode } = await runCliTest(["pr", "comment", "12", "--body-file", path], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(postedComment()).toEqual({ body: "From a file." });
  });

  it("truncates a body over 800 chars in the output, with the inline hint", async () => {
    const body = "z".repeat(1000);
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 201, body: createdComment({ body }) },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "comment", "12", "--body", body], {
      env: testModeEnv(server.url),
    });

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
      ["pr", "comment", "12", "--body", body, "--full"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(body);
    expect(stdout).not.toContain("truncated");
  });

  it("rejects a missing body before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "comment", "12"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--body");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a missing pull request number before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "comment", "--body", "hi"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("pull request number");
    expect(server.requests).toHaveLength(0);
  });

  it("reports a nonexistent pull request as PR_NOT_FOUND, not ISSUE_NOT_FOUND", async () => {
    server = await startFixtureServer([
      { method: "POST", path: COMMENTS_PATH, status: 404, body: { message: "Not Found" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "comment", "12", "--body", "hi"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    // The shared endpoint lives under /issues/, but the caller asked about a PR.
    expect(stdout).toContain("code: PR_NOT_FOUND");
    expect(stdout).toContain("Pull request #12");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "comment", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr comment <number>");
    expect(server.requests).toHaveLength(0);
  });
});
