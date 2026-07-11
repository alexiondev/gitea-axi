import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/42";
const COMMENTS_PATH = "/api/v1/repos/testowner/testrepo/issues/42/comments";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

function issueBody(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    number: 42,
    title: "Fix the thing",
    state: "open",
    user: { login: "alexion" },
    created_at: "2026-07-01T00:00:00Z",
    comments: 0,
    body: "",
    ...fields,
  };
}

describe("issue view", () => {
  it("renders the default detail fields plus comment_count", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUE_PATH,
        body: issueBody({ comments: 3, body: "A short body." }),
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("issue:");
    expect(stdout).toContain("number: 42");
    expect(stdout).toContain("title: Fix the thing");
    expect(stdout).toContain("state: open");
    expect(stdout).toContain("author: alexion");
    expect(stdout).toContain("body: A short body.");
    expect(stdout).toContain("comment_count: 3 — use --comments to see full comments");
  });

  it("renders comment_count: 0 when there are no comments", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ comments: 0 }) },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("comment_count: 0");
    expect(stdout).not.toContain("use --comments");
  });

  it("passes a body at or under 500 chars through untouched", async () => {
    const body = "b".repeat(500);
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ body }) },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain(body);
    expect(stdout).not.toContain("truncated");
    expect(stdout).not.toContain("cleaned");
  });

  it("cleans then truncates a body over 500 chars, with the inline hint", async () => {
    const body = `See http://127.0.0.1/o/r/issues/7 for context. ${"y".repeat(600)}`;
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ body }) },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    // cleanBody normalized the host URL before truncation kicked in.
    expect(stdout).toContain("Issue#7");
    expect(stdout).toContain(
      `... (truncated, ${body.length} chars total - use --full to see complete body)`,
    );
    expect(stdout).toContain("issue view 42 --full");
  });

  it("returns the cleaned body with a note when cleaning brings it under 500", async () => {
    const longUrl = `http://127.0.0.1/${"c".repeat(110)}`;
    const body = `${"d".repeat(480)} ${longUrl}`;
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ body }) },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("[long URL removed]");
    expect(stdout).toContain(`(cleaned, ${body.length} chars original - use --full to see original)`);
    expect(stdout).not.toContain("truncated,");
  });

  it("suppresses body truncation with --full", async () => {
    const body = "e".repeat(900);
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ body }) },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42", "--full"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain(body);
    expect(stdout).not.toContain("truncated");
  });

  it("renders every comment with --comments, truncating bodies at 800 chars", async () => {
    const longComment = "f".repeat(1000);
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ comments: 2 }) },
      {
        method: "GET",
        path: COMMENTS_PATH,
        body: [
          { user: { login: "bob" }, created_at: "2026-07-02T00:00:00Z", body: "short reply" },
          { user: { login: "sue" }, created_at: "2026-07-03T00:00:00Z", body: longComment },
        ],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42", "--comments"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comments[2]");
    expect(stdout).toContain("bob");
    expect(stdout).toContain("short reply");
    expect(stdout).toContain(
      `... (truncated, ${longComment.length} chars total - use --full to see complete body)`,
    );
    // With --comments the redundant scalar count is replaced by the block.
    expect(stdout).not.toContain("comment_count");
  });

  it("suppresses comment truncation with --full --comments", async () => {
    const longComment = "g".repeat(1000);
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ comments: 1 }) },
      {
        method: "GET",
        path: COMMENTS_PATH,
        body: [{ user: { login: "sue" }, created_at: "2026-07-03T00:00:00Z", body: longComment }],
      },
    ]);
    const { stdout } = await runCliTest(["issue", "view", "42", "--full", "--comments"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain(longComment);
    expect(stdout).not.toContain("truncated");
  });

  it("renders an explicit empty comments block when there are none", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ comments: 0 }) },
      { method: "GET", path: COMMENTS_PATH, body: [] },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42", "--comments"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comments[0]: (none)");
  });

  it("surfaces a failure to fetch comments", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: issueBody({ comments: 2 }) },
      { method: "GET", path: COMMENTS_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42", "--comments"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue view <number>");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a pull request number with VALIDATION_ERROR and a pr view hint", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUE_PATH,
        body: issueBody({ pull_request: { merged: false, html_url: "http://x/pulls/42" } }),
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("issue #42 is a pull request");
    expect(stdout).toContain("pr view 42");
  });

  it("reports a nonexistent issue as ISSUE_NOT_FOUND with exit 1", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUE_PATH,
        status: 404,
        body: { message: "Not Found" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "42"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: ISSUE_NOT_FOUND");
  });

  it("rejects a missing issue number with exit 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "view"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a non-numeric issue number with exit 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "view", "abc"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });
});
