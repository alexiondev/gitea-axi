import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, tempFiles, testModeEnv } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const PR_PATH = `${REPO_PATH}/pulls/9`;
const LABELS_ENDPOINT = `${REPO_PATH}/issues/9/labels`;
const REPO_LABELS = `${REPO_PATH}/labels`;
const MILESTONES_PATH = `${REPO_PATH}/milestones`;
const REVIEWERS_PATH = `${PR_PATH}/requested_reviewers`;

let server: FixtureServer;
const files = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

/** The parsed body of the single PATCH the CLI sent to the pull request. */
function patchedPull(): Record<string, unknown> {
  const patch = server.requests.find(
    (request) => request.method === "PATCH" && request.path === PR_PATH,
  );
  expect(patch, "expected a PATCH to the pull request").toBeDefined();
  return patch!.body as Record<string, unknown>;
}

function pull(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { number: 9, state: "open", assignees: [], ...fields };
}

describe("pr edit", () => {
  it("applies title, body, base, and milestone in one PATCH and reports the action", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: MILESTONES_PATH,
        query: { name: "v2.0" },
        body: [{ id: 8, title: "v2.0" }],
      },
      { method: "PATCH", path: PR_PATH, body: pull() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      [
        "pr",
        "edit",
        "9",
        "--title",
        "New title",
        "--body",
        "New body",
        "--base",
        "develop",
        "--milestone",
        "v2.0",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("edited:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("status: ok");
    expect(patchedPull()).toEqual({
      title: "New title",
      body: "New body",
      base: "develop",
      milestone: 8,
    });
  });

  it("reads the new body from --body-file", async () => {
    const path = files.write("body.md", "Body from a file.\n");
    server = await startFixtureServer([{ method: "PATCH", path: PR_PATH, body: pull() }]);
    const { exitCode } = await runCliTest(["pr", "edit", "9", "--body-file", path], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(patchedPull()).toEqual({ body: "Body from a file.\n" });
  });

  it("posts --add-label names directly to the additive label endpoint", async () => {
    server = await startFixtureServer([{ method: "POST", path: LABELS_ENDPOINT, body: [] }]);
    const { exitCode } = await runCliTest(
      ["pr", "edit", "9", "--add-label", "bug", "--add-label", "chore"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const post = server.requests.find(
      (request) => request.method === "POST" && request.path === LABELS_ENDPOINT,
    );
    expect(post?.body).toEqual({ labels: ["bug", "chore"] });
    // No label lookup happens for additions — names go straight through.
    expect(server.requests.some((request) => request.path === REPO_LABELS)).toBe(false);
  });

  it("resolves --remove-label to an id before deleting it", async () => {
    server = await startFixtureServer([
      { method: "GET", path: REPO_LABELS, body: [{ id: 22, name: "Priority: High" }] },
      { method: "DELETE", path: `${LABELS_ENDPOINT}/22`, body: {} },
    ]);
    const { exitCode } = await runCliTest(["pr", "edit", "9", "--remove-label", "priority: high"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(
      server.requests.some(
        (request) => request.method === "DELETE" && request.path === `${LABELS_ENDPOINT}/22`,
      ),
    ).toBe(true);
  });

  it("treats a 404 removing an unapplied label as silent success", async () => {
    server = await startFixtureServer([
      { method: "GET", path: REPO_LABELS, body: [{ id: 22, name: "wontfix" }] },
      { method: "DELETE", path: `${LABELS_ENDPOINT}/22`, status: 404, body: { message: "not found" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "edit", "9", "--remove-label", "wontfix"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("edited:");
    expect(stdout).toContain("status: ok");
  });

  it("adds and removes assignees via fetch-then-patch, sending the full resulting list", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PR_PATH,
        body: pull({ assignees: [{ login: "alice" }, { login: "bob" }] }),
      },
      { method: "PATCH", path: PR_PATH, body: pull() },
    ]);
    const { exitCode } = await runCliTest(
      ["pr", "edit", "9", "--add-assignee", "carol", "--remove-assignee", "alice"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(patchedPull()).toEqual({ assignees: ["bob", "carol"] });
    // Exactly one PATCH carries the whole recomputed list.
    expect(server.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it("requests a review via the requested-reviewers POST endpoint", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWERS_PATH, body: [] }]);
    const { exitCode } = await runCliTest(["pr", "edit", "9", "--add-reviewer", "dana"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const post = server.requests.find(
      (request) => request.method === "POST" && request.path === REVIEWERS_PATH,
    );
    expect(post?.body).toEqual({ reviewers: ["dana"] });
    // No PATCH: reviewers do not travel on the edit body.
    expect(server.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("cancels a requested review via the requested-reviewers DELETE endpoint", async () => {
    server = await startFixtureServer([{ method: "DELETE", path: REVIEWERS_PATH, body: {} }]);
    const { exitCode } = await runCliTest(["pr", "edit", "9", "--remove-reviewer", "dana"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const del = server.requests.find(
      (request) => request.method === "DELETE" && request.path === REVIEWERS_PATH,
    );
    expect(del?.body).toEqual({ reviewers: ["dana"] });
  });

  it("adds and removes reviewers in one POST and one DELETE", async () => {
    server = await startFixtureServer([
      { method: "POST", path: REVIEWERS_PATH, body: [] },
      { method: "DELETE", path: REVIEWERS_PATH, body: {} },
    ]);
    const { exitCode } = await runCliTest(
      [
        "pr",
        "edit",
        "9",
        "--add-reviewer",
        "dana",
        "--add-reviewer",
        "erin",
        "--remove-reviewer",
        "frank",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const post = server.requests.find((request) => request.method === "POST");
    const del = server.requests.find((request) => request.method === "DELETE");
    expect(post?.body).toEqual({ reviewers: ["dana", "erin"] });
    expect(del?.body).toEqual({ reviewers: ["frank"] });
  });

  it("rejects an edit with no changes before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "edit", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "edit", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr edit");
    expect(server.requests).toHaveLength(0);
  });
});
