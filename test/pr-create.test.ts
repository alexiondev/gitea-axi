import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, tempFiles, testModeEnv } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const PULLS_PATH = `${REPO_PATH}/pulls`;
const LABELS_PATH = `${REPO_PATH}/labels`;
const MILESTONES_PATH = `${REPO_PATH}/milestones`;
/** The by-base-head lookup Gitea exposes for the idempotency check. */
const BASE_HEAD_PATH = `${PULLS_PATH}/main/feature-x`;

const root = mkdtempSync(join(tmpdir(), "gitea-axi-pr-"));
let repoCounter = 0;

let server: FixtureServer;
const files = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A real git repository checked out on `branch`, for the tests that exercise
 * the `--head` default. It needs a commit: `git rev-parse --abbrev-ref HEAD`
 * has no revision to resolve on an unborn branch.
 */
function repoOnBranch(branch: string): string {
  const dir = mkdtempSync(join(root, `repo-${repoCounter++}-`));
  execFileSync("git", ["init", "--quiet", "-b", branch], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet",
    "--allow-empty", "-m", "seed"], { cwd: dir });
  return dir;
}

/** Test-mode env plus the PATH the git subprocess needs to be found on. */
function gitEnv(url: string): Record<string, string | undefined> {
  return { ...testModeEnv(url), PATH: process.env.PATH };
}

function createdPull(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 12,
    title: "Add the thing",
    state: "open",
    html_url: "http://127.0.0.1/testowner/testrepo/pulls/12",
    ...fields,
  };
}

/** No PR exists for the branch pair — Gitea answers the by-base-head lookup with a 404. */
const NO_EXISTING_PR = {
  method: "GET",
  path: BASE_HEAD_PATH,
  status: 404,
  body: { message: "Not Found" },
} as const;

const DEFAULT_BRANCH = {
  method: "GET",
  path: REPO_PATH,
  body: { default_branch: "main" },
} as const;

function postedPull(): Record<string, unknown> {
  return postedBody(server, PULLS_PATH);
}

function posted(): boolean {
  return server.requests.some((request) => request.method === "POST");
}

describe("pr create", () => {
  it("creates a pull request and renders the created action block", async () => {
    server = await startFixtureServer([
      NO_EXISTING_PR,
      { method: "POST", path: PULLS_PATH, status: 201, body: createdPull() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "Add the thing", "--base", "main", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    // The mutation ran, so the block is named for the action, not the entity.
    expect(stdout).toContain("created:");
    expect(stdout).not.toContain("pull_request:");
    expect(stdout).toContain("number: 12");
    expect(stdout).toContain('url: "http://127.0.0.1/testowner/testrepo/pulls/12"');
    expect(postedPull()).toEqual({
      title: "Add the thing",
      base: "main",
      head: "feature-x",
    });
  });

  it("defaults --head to the current branch and --base to the repo's default branch", async () => {
    server = await startFixtureServer([
      DEFAULT_BRANCH,
      NO_EXISTING_PR,
      { method: "POST", path: PULLS_PATH, status: 201, body: createdPull() },
    ]);
    const { exitCode } = await runCliTest(["pr", "create", "--title", "T"], {
      env: gitEnv(server.url),
      cwd: repoOnBranch("feature-x"),
    });

    expect(exitCode).toBe(0);
    expect(postedPull()).toEqual({ title: "T", base: "main", head: "feature-x" });
  });

  it("short-circuits to the existing open pull request without creating a duplicate", async () => {
    server = await startFixtureServer([
      { method: "GET", path: BASE_HEAD_PATH, body: createdPull() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "Add the thing", "--base", "main", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    // A no-op reports the entity, not the action.
    expect(stdout).toContain("pull_request:");
    expect(stdout).not.toContain("created:");
    expect(stdout).toContain("number: 12");
    expect(stdout).toContain('url: "http://127.0.0.1/testowner/testrepo/pulls/12"');
    expect(stdout).toContain("already: true");
    expect(posted()).toBe(false);
  });

  it("creates a fresh pull request when the only match for the branch pair is closed", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: BASE_HEAD_PATH,
        body: createdPull({ number: 3, state: "closed" }),
      },
      { method: "POST", path: PULLS_PATH, status: 201, body: createdPull() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "Add the thing", "--base", "main", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("created:");
    expect(stdout).toContain("number: 12");
    expect(posted()).toBe(true);
  });

  it("resolves --label and --milestone names and passes --assignee and --reviewer through", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        body: [
          { id: 11, name: "bug" },
          { id: 22, name: "Priority: High" },
        ],
      },
      {
        method: "GET",
        path: MILESTONES_PATH,
        query: { name: "v1.0" },
        body: [{ id: 5, title: "V1.0" }],
      },
      NO_EXISTING_PR,
      { method: "POST", path: PULLS_PATH, status: 201, body: createdPull() },
    ]);
    const { exitCode } = await runCliTest(
      [
        "pr", "create",
        "--title", "T",
        "--base", "main",
        "--head", "feature-x",
        "--label", "BUG",
        "--label", "priority: high",
        "--milestone", "v1.0",
        "--assignee", "alexion",
        "--reviewer", "reviewer-one",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedPull()).toEqual({
      title: "T",
      base: "main",
      head: "feature-x",
      labels: [11, 22],
      milestone: 5,
      assignees: ["alexion"],
      reviewers: ["reviewer-one"],
    });
  });

  it("rejects an unknown --label name with VALIDATION_ERROR and creates nothing", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
      NO_EXISTING_PR,
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--base", "main", "--head", "feature-x", "--label", "nope"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("nope");
    expect(posted()).toBe(false);
  });

  it("rejects an unknown --milestone name with VALIDATION_ERROR and creates nothing", async () => {
    server = await startFixtureServer([
      { method: "GET", path: MILESTONES_PATH, body: [] },
      NO_EXISTING_PR,
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--base", "main", "--head", "feature-x", "--milestone", "ghost"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("ghost");
    expect(posted()).toBe(false);
  });

  it("reads the body from --body-file", async () => {
    const path = files.write("body.md", "From a file.\n");
    server = await startFixtureServer([
      NO_EXISTING_PR,
      { method: "POST", path: PULLS_PATH, status: 201, body: createdPull() },
    ]);
    const { exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--base", "main", "--head", "feature-x", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedPull()).toEqual({
      title: "T",
      base: "main",
      head: "feature-x",
      body: "From a file.\n",
    });
  });

  it("rejects a missing --title before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "create", "--base", "main", "--head", "x"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--title");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects an unresolvable current branch with VALIDATION_ERROR, before calling the API", async () => {
    // Not a git repository, so the head branch cannot be read from git and the
    // caller must name it themselves.
    const cwd = mkdtempSync(join(root, "bare-"));
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "create", "--title", "T"], {
      env: gitEnv(server.url),
      cwd,
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--head");
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces a failure to fetch the default branch", async () => {
    server = await startFixtureServer([
      { method: "GET", path: REPO_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--head", "feature-x"],
      { env: gitEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    expect(posted()).toBe(false);
  });

  it("surfaces a server-side rejection of the create", async () => {
    server = await startFixtureServer([
      NO_EXISTING_PR,
      {
        method: "POST",
        path: PULLS_PATH,
        status: 422,
        body: { message: "head branch does not exist" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--base", "main", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("head branch does not exist");
  });

  it("rejects an unexpected positional argument before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "create", "12", "--title", "T"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("12");
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces a failure of the existing-pull-request check that is not a 404", async () => {
    // Only a 404 means "no such pull request"; anything else is a real failure
    // and must not be mistaken for a clear runway to create one.
    server = await startFixtureServer([
      { method: "GET", path: BASE_HEAD_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--base", "main", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    expect(posted()).toBe(false);
  });

  it("asks for --base when the repository reports no default branch", async () => {
    server = await startFixtureServer([{ method: "GET", path: REPO_PATH, body: {} }]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "T", "--head", "feature-x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--base");
    expect(posted()).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "create", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr create");
    expect(server.requests).toHaveLength(0);
  });
});
