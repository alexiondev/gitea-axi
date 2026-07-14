import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, tempFiles, testModeEnv, type TempFiles } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const PR_PATH = `${REPO_PATH}/pulls/9`;
const MERGE_PATH = `${PR_PATH}/merge`;

let server: FixtureServer;
const files: TempFiles = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

/** The open PR the idempotency GET reads before a merge is attempted. */
function openPull() {
  return { method: "GET", path: PR_PATH, body: { number: 9, state: "open" } } as const;
}

function mergePosted() {
  return server.requests.find(
    (request) => request.method === "POST" && request.path === MERGE_PATH,
  );
}

describe("pr merge", () => {
  it.each([
    ["--method", "merge", "merge"],
    ["--method", "squash", "squash"],
    ["--method", "rebase", "rebase"],
    ["--method", "rebase-merge", "rebase-merge"],
    ["--method", "fast-forward-only", "fast-forward-only"],
  ])("sends Do=%s %s and reports the method", async (flag, value, expected) => {
    server = await startFixtureServer([openPull(), { method: "POST", path: MERGE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9", flag, value], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("merged:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("status: ok");
    expect(stdout).toContain(`method: ${expected}`);
    expect(mergePosted()?.body).toEqual({ Do: value });
  });

  it("merges the manually-merged method with its required --merge-commit-id", async () => {
    server = await startFixtureServer([openPull(), { method: "POST", path: MERGE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "merge", "9", "--method", "manually-merged", "--merge-commit-id", "abc123"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("method: manually-merged");
    expect(mergePosted()?.body).toEqual({ Do: "manually-merged", MergeCommitID: "abc123" });
  });

  it.each([
    ["--merge", "merge"],
    ["--squash", "squash"],
    ["--rebase", "rebase"],
  ])("maps the %s shorthand to Do=%s", async (shorthand, expected) => {
    server = await startFixtureServer([openPull(), { method: "POST", path: MERGE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9", shorthand], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`method: ${expected}`);
    expect(mergePosted()?.body).toEqual({ Do: expected });
  });

  it("defaults to Do=merge but reports method: default when none is given", async () => {
    server = await startFixtureServer([openPull(), { method: "POST", path: MERGE_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("method: default");
    expect(mergePosted()?.body).toEqual({ Do: "merge" });
  });

  it("forwards --auto, --delete-branch, --subject, and --body-file", async () => {
    server = await startFixtureServer([openPull(), { method: "POST", path: MERGE_PATH, body: {} }]);
    const path = files.write("msg.txt", "Body from a file");
    const { exitCode } = await runCliTest(
      [
        "pr",
        "merge",
        "9",
        "--squash",
        "--auto",
        "--delete-branch",
        "--subject",
        "Ship it",
        "--body-file",
        path,
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(mergePosted()?.body).toEqual({
      Do: "squash",
      MergeTitleField: "Ship it",
      MergeMessageField: "Body from a file",
      merge_when_checks_succeed: true,
      delete_branch_after_merge: true,
    });
  });

  it.each([
    ["--merge", "--squash"],
    ["--method", "merge", "--rebase"],
  ])("rejects conflicting method flags before any API call", async (...args) => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9", ...args], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("Choose only one merge method");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects an invalid --method value", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9", "--method", "octopus"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects --merge-commit-id without --method manually-merged", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "merge", "9", "--squash", "--merge-commit-id", "abc123"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--merge-commit-id is only valid with --method manually-merged");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects --method manually-merged without --merge-commit-id", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "merge", "9", "--method", "manually-merged"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--method manually-merged requires --merge-commit-id");
    expect(server.requests).toHaveLength(0);
  });

  it("short-circuits an already-merged pull request without calling the merge API", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PR_PATH,
        body: {
          number: 9,
          state: "closed",
          merged: true,
          merged_by: { login: "octocat" },
          merged_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull_request:");
    expect(stdout).toContain("state: merged");
    expect(stdout).toContain("merged_by: octocat");
    expect(stdout).toContain("merged_at: 2d ago");
    expect(mergePosted()).toBeUndefined();
  });

  it("maps a 405 not-mergeable response to VALIDATION_ERROR with remediation help", async () => {
    server = await startFixtureServer([
      openPull(),
      {
        method: "POST",
        path: MERGE_PATH,
        status: 405,
        body: { message: "The pull request cannot be merged, base branch is out of date" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("base branch is out of date");
    expect(stdout).toContain("pr update-branch 9");
    expect(stdout).toContain("pr checkout 9");
  });

  it("maps a 409 conflict response to VALIDATION_ERROR", async () => {
    server = await startFixtureServer([
      openPull(),
      { method: "POST", path: MERGE_PATH, status: 409, body: { message: "merge conflict" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "9", "--rebase"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("merge conflict");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "merge", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr merge");
    expect(server.requests).toHaveLength(0);
  });
});
