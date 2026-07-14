import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, tempFiles, testModeEnv } from "./harness.js";

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";
const LABELS_PATH = "/api/v1/repos/testowner/testrepo/labels";
const MILESTONES_PATH = "/api/v1/repos/testowner/testrepo/milestones";

let server: FixtureServer;
const files = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

function createdIssue(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: "Fix the thing",
    state: "open",
    html_url: "http://127.0.0.1/testowner/testrepo/issues/7",
    user: { login: "alexion" },
    created_at: "2026-07-01T00:00:00Z",
    body: "",
    labels: [],
    assignees: [],
    ...fields,
  };
}

/** The single POST the CLI sent to the issues endpoint. */
function postedIssue(): Record<string, unknown> {
  return postedBody(server, ISSUES_PATH);
}

describe("issue create", () => {
  it("creates an issue and renders number, title, state, and url", async () => {
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "Fix the thing"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("issue:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("title: Fix the thing");
    expect(stdout).toContain("state: open");
    // TOON quotes the URL because it contains the key/value separator.
    expect(stdout).toContain('url: "http://127.0.0.1/testowner/testrepo/issues/7"');
    expect(postedIssue()).toEqual({ title: "Fix the thing" });
  });

  it("suggests viewing the issue it just created, with the real number", async () => {
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { stdout } = await runCliTest(["issue", "create", "--title", "Fix the thing"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("issue view 7");
  });

  it("sends the body from --body", async () => {
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--body", "Some details."],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", body: "Some details." });
  });

  it("reads the body from --body-file", async () => {
    const path = files.write("body.md", "From a file.\nSecond line.\n");
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", body: "From a file.\nSecond line.\n" });
  });

  it("rejects --body and --body-file together before calling the API", async () => {
    const path = files.write("body.md", "x");
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--body", "x", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("reports an unreadable --body-file as VALIDATION_ERROR", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--body-file", "/nonexistent/nope.md"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a missing --title before calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "create"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--title");
    expect(server.requests).toHaveLength(0);
  });

  it("resolves repeated --label names to ids, case-insensitively", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        body: [
          { id: 11, name: "bug" },
          { id: 22, name: "Priority: High" },
          { id: 33, name: "chore" },
        ],
      },
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--label", "BUG", "--label", "priority: high"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", labels: [11, 22] });
  });

  it("rejects an unknown --label name with VALIDATION_ERROR and creates nothing", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--label", "nope"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("nope");
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("finds a label that only appears on a later page of labels", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      name: `filler-${index}`,
    }));
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, query: { page: "1" }, body: firstPage },
      {
        method: "GET",
        path: LABELS_PATH,
        query: { page: "2" },
        body: [{ id: 99, name: "needle" }],
      },
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--label", "needle"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", labels: [99] });
  });

  it("surfaces a failure to list labels", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--label", "bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("surfaces a failure to list milestones", async () => {
    server = await startFixtureServer([
      { method: "GET", path: MILESTONES_PATH, status: 403, body: { message: "forbidden" } },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--milestone", "v1.0"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("renders empty extra fields when the issue has no labels, assignees, or milestone", async () => {
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue({ labels: null }) },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--fields", "labels,assignees,milestone"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('labels: ""');
    expect(stdout).toContain('assignees: ""');
    expect(stdout).toContain('milestone: ""');
  });

  it("resolves --milestone to its id, case-insensitively", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: MILESTONES_PATH,
        query: { name: "v1.0" },
        body: [{ id: 5, title: "V1.0" }],
      },
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--milestone", "v1.0"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", milestone: 5 });
  });

  it("rejects an unknown --milestone name with VALIDATION_ERROR and creates nothing", async () => {
    server = await startFixtureServer([
      { method: "GET", path: MILESTONES_PATH, body: [] },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--milestone", "ghost"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("ghost");
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("passes --assignee through as an assignees list", async () => {
    server = await startFixtureServer([
      { method: "POST", path: ISSUES_PATH, status: 201, body: createdIssue() },
    ]);
    const { exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--assignee", "alexion"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedIssue()).toEqual({ title: "T", assignees: ["alexion"] });
  });

  it("appends the extra fields named by --fields", async () => {
    server = await startFixtureServer([
      {
        method: "POST",
        path: ISSUES_PATH,
        status: 201,
        body: createdIssue({
          body: "The body.",
          labels: [{ id: 11, name: "bug" }, { id: 22, name: "chore" }],
          assignees: [{ login: "alexion" }],
          milestone: { id: 5, title: "v1.0" },
        }),
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--fields", "labels,assignees,milestone,body"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    // TOON quotes the joined labels because they contain its list delimiter.
    expect(stdout).toContain('labels: "bug, chore"');
    expect(stdout).toContain("assignees: alexion");
    expect(stdout).toContain("milestone: v1.0");
    expect(stdout).toContain("body: The body.");
    // The default fields stay in place alongside the requested extras.
    expect(stdout).toContain("number: 7");
  });

  it("applies the body-truncation ruling to a created issue, and --full suppresses it", async () => {
    // Truncated inline at 500 chars with the hint.
    server = await startFixtureServer([
      {
        method: "POST",
        path: ISSUES_PATH,
        status: 201,
        body: createdIssue({ body: "x".repeat(650) }),
      },
    ]);
    const truncated = await runCliTest(
      ["issue", "create", "--title", "T", "--fields", "body"],
      { env: testModeEnv(server.url) },
    );

    expect(truncated.exitCode).toBe(0);
    expect(truncated.stdout).toContain("x".repeat(500));
    expect(truncated.stdout).toContain(
      "... (truncated, 650 chars total - use --full to see complete body)",
    );
    expect(truncated.stdout).not.toContain("x".repeat(650));

    // --full returns the body raw, with no truncation hint.
    await server.close();
    server = await startFixtureServer([
      {
        method: "POST",
        path: ISSUES_PATH,
        status: 201,
        body: createdIssue({ body: "x".repeat(650) }),
      },
    ]);
    const full = await runCliTest(
      ["issue", "create", "--title", "T", "--fields", "body", "--full"],
      { env: testModeEnv(server.url) },
    );

    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("x".repeat(650));
    expect(full.stdout).not.toContain("truncated");
  });

  it("rejects an unknown --fields name with VALIDATION_ERROR", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "T", "--fields", "nonsense"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("nonsense");
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces a server-side rejection of the create", async () => {
    server = await startFixtureServer([
      {
        method: "POST",
        path: ISSUES_PATH,
        status: 422,
        body: { message: "title is empty" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "create", "--title", "T"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("title is empty");
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "create", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue create");
    expect(server.requests).toHaveLength(0);
  });
});
