import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, tempFiles, testModeEnv, type TempFiles } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const REVIEWS_PATH = `${REPO_PATH}/pulls/9/reviews`;

let server: FixtureServer;
const files: TempFiles = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

function reviewPosted() {
  return server.requests.find(
    (request) => request.method === "POST" && request.path === REVIEWS_PATH,
  );
}

describe("pr review", () => {
  it("submits an APPROVED review and reports number and action for --approve", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", "--approve"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event: "APPROVED" });
    expect(stdout).toContain("review:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("action: approve");
  });

  it.each([
    ["--request-changes", "REQUEST_CHANGES", "request-changes"],
    ["--comment", "COMMENT", "comment"],
  ])("submits %s as event %s and reports action %s", async (flag, event, action) => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", flag], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event });
    expect(stdout).toContain("review:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain(`action: ${action}`);
  });

  it("rejects zero action flags before any API call", async () => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it.each([
    ["--approve", "--comment"],
    ["--approve", "--request-changes"],
    ["--request-changes", "--comment"],
  ])("rejects multiple action flags (%s %s) before any API call", async (...actions) => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", ...actions], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces a 422 from the server as VALIDATION_ERROR carrying its message", async () => {
    server = await startFixtureServer([
      {
        method: "POST",
        path: REVIEWS_PATH,
        status: 422,
        body: { message: "review body cannot be empty" },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", "--request-changes"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("review body cannot be empty");
  });

  it("forwards a --body review body inline", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--body", "Looks good"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event: "COMMENT", body: "Looks good" });
  });

  it("maps a --comments-file new-comment entry to comments[] with new_position and reports the count", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ path: "src/x.ts", line: 42, body: "fresh point" }]),
    );

    const { stdout, exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--comments-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "COMMENT",
      comments: [{ path: "src/x.ts", new_position: 42, body: "fresh point" }],
    });
    expect(stdout).toContain("action: comment");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("comments: 1");
  });

  it("reconstructs a reply's anchor from the target comment's diff_hunk via the reviews fan-out", async () => {
    server = await startFixtureServer([
      { method: "POST", path: REVIEWS_PATH, body: {} },
      {
        method: "GET",
        path: REVIEWS_PATH,
        body: [{ id: 30, state: "COMMENT", user: { login: "rev" } }],
      },
      {
        method: "GET",
        path: `${REVIEWS_PATH}/30/comments`,
        body: [
          {
            id: 500,
            path: "src/a.ts",
            diff_hunk: "@@ -10,3 +10,4 @@\n ctxA\n ctxB\n+added",
            body: "orig",
          },
        ],
      },
    ]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ reply_to: 500, body: "my reply" }]),
    );

    const { stdout, exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--comments-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "COMMENT",
      comments: [{ path: "src/a.ts", new_position: 12, body: "my reply" }],
    });
    expect(stdout).toContain("comments: 1");
  });

  it("rejects a reply whose reply_to id is not among the PR's review comments without posting", async () => {
    server = await startFixtureServer([
      { method: "POST", path: REVIEWS_PATH, body: {} },
      {
        method: "GET",
        path: REVIEWS_PATH,
        body: [{ id: 30, state: "COMMENT", user: { login: "rev" } }],
      },
      {
        method: "GET",
        path: `${REVIEWS_PATH}/30/comments`,
        body: [
          {
            id: 500,
            path: "src/a.ts",
            diff_hunk: "@@ -10,3 +10,4 @@\n ctxA\n ctxB\n+added",
            body: "orig",
          },
        ],
      },
    ]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ reply_to: 999, body: "reply to nobody" }]),
    );

    const { stdout, exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--comments-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(reviewPosted()).toBeUndefined();
  });

  it("composes a top-level --body with the inline comments batch in one payload", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ path: "src/y.ts", line: 7, body: "inline note" }]),
    );

    const { exitCode } = await runCliTest(
      [
        "pr",
        "review",
        "9",
        "--request-changes",
        "--body",
        "overall: please fix",
        "--comments-file",
        path,
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "REQUEST_CHANGES",
      body: "overall: please fix",
      comments: [{ path: "src/y.ts", new_position: 7, body: "inline note" }],
    });
  });

  it("anchors a reply on a deleted line to old_position inferred from the target", async () => {
    server = await startFixtureServer([
      { method: "POST", path: REVIEWS_PATH, body: {} },
      {
        method: "GET",
        path: REVIEWS_PATH,
        body: [{ id: 40, state: "COMMENT", user: { login: "rev" } }],
      },
      {
        method: "GET",
        path: `${REVIEWS_PATH}/40/comments`,
        body: [
          {
            id: 700,
            path: "src/b.ts",
            diff_hunk: "@@ -20,2 +20,1 @@\n ctx1\n-removed",
            body: "orig",
          },
        ],
      },
    ]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ reply_to: 700, body: "reply on deletion" }]),
    );

    const { exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--comments-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "COMMENT",
      comments: [{ path: "src/b.ts", old_position: 21, body: "reply on deletion" }],
    });
  });

  it("rejects a comments-file entry mixing reply_to with path/line before any API call", async () => {
    server = await startFixtureServer([]);
    const path = files.write(
      "comments.json",
      JSON.stringify([{ reply_to: 500, path: "src/a.ts", line: 3, body: "confused entry" }]),
    );

    const { stdout, exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--comments-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("forwards a --body-file review body from the file contents", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);
    const path = files.write("review.txt", "Please fix the tests");

    const { exitCode } = await runCliTest(
      ["pr", "review", "9", "--request-changes", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "REQUEST_CHANGES",
      body: "Please fix the tests",
    });
  });
});
