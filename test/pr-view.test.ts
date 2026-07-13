import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const PULL_PATH = "/api/v1/repos/testowner/testrepo/pulls/5";
const REVIEWS_PATH = "/api/v1/repos/testowner/testrepo/pulls/5/reviews";
const STATUS_PATH = "/api/v1/repos/testowner/testrepo/commits/abc123/status";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("pr view", () => {
  it("renders the default fields from the PR, its reviews, and the head commit status", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: {
          number: 5,
          title: "Add feature",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 2,
          body: "Some body text.",
          head: { sha: "abc123", ref: "feature" },
        },
      },
      {
        method: "GET",
        path: REVIEWS_PATH,
        body: [
          {
            id: 1,
            state: "APPROVED",
            official: false,
            stale: false,
            dismissed: false,
            user: { login: "reviewer" },
          },
        ],
      },
      {
        method: "GET",
        path: STATUS_PATH,
        body: {
          sha: "abc123",
          total_count: 1,
          statuses: [{ context: "build", status: "success" }],
        },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull_request:");
    expect(stdout).toContain("number: 5");
    expect(stdout).toContain("title: Add feature");
    expect(stdout).toContain("state: open");
    expect(stdout).toContain("author: alexion");
    expect(stdout).toContain("draft: no");
    expect(stdout).toContain("merged: no");
    expect(stdout).toContain('checks: "1 passed, 0 failed, 1 total"');
    expect(stdout).toContain("body: Some body text.");
    expect(stdout).toContain("comment_count: 2 — use --comments to see full comments");
    expect(stdout).toContain("review_count: 1 — use --reviews to see full reviews");
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("renders every comment with --comments, dropping comment_count and truncating at 800 chars", async () => {
    const longComment = "f".repeat(1000);
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: {
          number: 5,
          title: "Add feature",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 2,
          body: "Body.",
          head: { sha: "abc123", ref: "feature" },
        },
      },
      { method: "GET", path: REVIEWS_PATH, body: [] },
      {
        method: "GET",
        path: STATUS_PATH,
        body: {
          sha: "abc123",
          total_count: 1,
          statuses: [{ context: "build", status: "success" }],
        },
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/issues/5/comments",
        body: [
          { user: { login: "bob" }, created_at: "2026-07-02T00:00:00Z", body: "short reply" },
          { user: { login: "sue" }, created_at: "2026-07-03T00:00:00Z", body: longComment },
        ],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "5", "--comments"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comments[2]{author,created,body}:");
    expect(stdout).toContain("bob");
    expect(stdout).toContain("short reply");
    expect(stdout).toContain(
      "... (truncated, 1000 chars total - use --full to see complete body)",
    );
    expect(stdout).not.toContain("comment_count");
    expect(stdout).toContain("review_count: 0");
  });

  it("renders every review with official/stale and inline comments with --reviews, dropping review_count", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/7",
        body: {
          number: 7,
          title: "Feature",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 0,
          body: "Body.",
          head: { sha: "sha7", ref: "feature" },
        },
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/7/reviews",
        body: [
          {
            id: 11,
            state: "APPROVED",
            official: true,
            stale: false,
            dismissed: false,
            user: { login: "reviewer" },
            body: "looks good",
          },
          {
            id: 12,
            state: "REQUEST_CHANGES",
            official: false,
            stale: true,
            dismissed: false,
            user: { login: "carol" },
            body: "please fix",
          },
        ],
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/7/reviews/11/comments",
        body: [{ user: { login: "alice" }, path: "src/x.ts", body: "nit here" }],
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/7/reviews/12/comments",
        body: [],
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/commits/sha7/status",
        body: { sha: "sha7", total_count: 0, statuses: [] },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "7", "--reviews"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("reviews[2]:");
    expect(stdout).toContain("    state: approved");
    expect(stdout).toContain("    state: request_changes");
    expect(stdout).toContain("    official: yes");
    expect(stdout).toContain("    official: no");
    expect(stdout).toContain("    stale: no");
    expect(stdout).toContain("    stale: yes");
    expect(stdout).toContain("    comments[1]{author,path,body}:");
    expect(stdout).toContain("      alice,src/x.ts,nit here");
    expect(stdout).not.toContain("review_count");
    expect(stdout).toContain("comment_count");
  });

  it("reports a nonexistent PR as PR_NOT_FOUND with exit 1", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/999",
        status: 404,
        body: { message: "Not Found" },
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/999/reviews",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "999"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: PR_NOT_FOUND");
  });

  it("suppresses PR body and comment truncation with --full --comments", async () => {
    const body = "e".repeat(900);
    const longComment = "g".repeat(1000);
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/8",
        body: {
          number: 8,
          title: "T",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 1,
          body,
          head: { sha: "sha8", ref: "f" },
        },
      },
      { method: "GET", path: "/api/v1/repos/testowner/testrepo/pulls/8/reviews", body: [] },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/commits/sha8/status",
        body: { sha: "sha8", total_count: 0, statuses: [] },
      },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/issues/8/comments",
        body: [{ user: { login: "sue" }, created_at: "2026-07-03T00:00:00Z", body: longComment }],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "8", "--comments", "--full"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(body);
    expect(stdout).toContain(longComment);
    expect(stdout).not.toContain("truncated");
  });

  it("renders the no-CI-checks message in the checks field when no statuses exist", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/9",
        body: {
          number: 9,
          title: "T",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 0,
          body: "Body.",
          head: { sha: "sha9", ref: "f" },
        },
      },
      { method: "GET", path: "/api/v1/repos/testowner/testrepo/pulls/9/reviews", body: [] },
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/commits/sha9/status",
        body: { sha: "sha9", total_count: 0, statuses: [] },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      'checks: "0 passed, 0 failed — this PR has no CI checks configured"',
    );
  });

  it("truncates a PR body over 500 chars with the inline hint and a --full suggestion", async () => {
    const body = "z".repeat(600);
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: {
          number: 5,
          title: "T",
          state: "open",
          user: { login: "alexion" },
          draft: false,
          merged: false,
          comments: 0,
          body,
          head: { sha: "abc123", ref: "f" },
        },
      },
      { method: "GET", path: REVIEWS_PATH, body: [] },
      {
        method: "GET",
        path: STATUS_PATH,
        body: { sha: "abc123", total_count: 0, statuses: [] },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "view", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "... (truncated, 600 chars total - use --full to see complete body)",
    );
    expect(stdout).toContain("pr view 5 --full");
  });
});
