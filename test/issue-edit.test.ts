import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, tempFiles, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/7";
const LABELS_ENDPOINT = "/api/v1/repos/testowner/testrepo/issues/7/labels";
const REPO_LABELS = "/api/v1/repos/testowner/testrepo/labels";
const MILESTONES_PATH = "/api/v1/repos/testowner/testrepo/milestones";

let server: FixtureServer;
const files = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

/** The parsed body of the single PATCH the CLI sent to the issue. */
function patchedIssue(): Record<string, unknown> {
  const patch = server.requests.find(
    (request) => request.method === "PATCH" && request.path === ISSUE_PATH,
  );
  expect(patch, "expected a PATCH to the issue").toBeDefined();
  return patch!.body as Record<string, unknown>;
}

function issue(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { number: 7, state: "open", assignees: [], ...fields };
}

describe("issue edit", () => {
  it("applies title, body, and milestone in one PATCH and reports the action", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: MILESTONES_PATH,
        query: { name: "v1.0" },
        body: [{ id: 5, title: "v1.0" }],
      },
      { method: "PATCH", path: ISSUE_PATH, body: issue() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "edit", "7", "--title", "New title", "--body", "New body", "--milestone", "v1.0"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("edited:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("status: ok");
    expect(patchedIssue()).toEqual({ title: "New title", body: "New body", milestone: 5 });
  });

  it("reads the new body from --body-file", async () => {
    const path = files.write("body.md", "Body from a file.\n");
    server = await startFixtureServer([{ method: "PATCH", path: ISSUE_PATH, body: issue() }]);
    const { exitCode } = await runCliTest(
      ["issue", "edit", "7", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(patchedIssue()).toEqual({ body: "Body from a file.\n" });
  });

  it("posts --add-label names directly to the additive label endpoint", async () => {
    server = await startFixtureServer([
      { method: "POST", path: LABELS_ENDPOINT, body: [] },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "edit", "7", "--add-label", "bug", "--add-label", "chore"],
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
    const { exitCode } = await runCliTest(
      ["issue", "edit", "7", "--remove-label", "priority: high"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(
      server.requests.some(
        (request) => request.method === "DELETE" && request.path === `${LABELS_ENDPOINT}/22`,
      ),
    ).toBe(true);
  });

  it("rejects a --remove-label name not in the repo with VALIDATION_ERROR and mutates nothing", async () => {
    server = await startFixtureServer([
      { method: "GET", path: REPO_LABELS, body: [{ id: 11, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "edit", "7", "--remove-label", "ghost"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("ghost");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("treats a 404 removing an unapplied label as silent success", async () => {
    server = await startFixtureServer([
      { method: "GET", path: REPO_LABELS, body: [{ id: 22, name: "wontfix" }] },
      { method: "DELETE", path: `${LABELS_ENDPOINT}/22`, status: 404, body: { message: "not found" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "edit", "7", "--remove-label", "wontfix"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("edited:");
    expect(stdout).toContain("status: ok");
  });

  it("adds and removes assignees via fetch-then-patch, sending the full resulting list", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUE_PATH,
        body: issue({ assignees: [{ login: "alice" }, { login: "bob" }] }),
      },
      { method: "PATCH", path: ISSUE_PATH, body: issue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "edit", "7", "--add-assignee", "carol", "--remove-assignee", "alice"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(patchedIssue()).toEqual({ assignees: ["bob", "carol"] });
    // Exactly one PATCH carries the whole recomputed list.
    expect(server.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it("rejects an edit with no changes before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "edit", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "edit", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue edit");
    expect(server.requests).toHaveLength(0);
  });
});
