import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("issue list", () => {
  it("lists open issues with default fields and a count line", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        query: { state: "open", type: "issues", limit: "30", page: "1" },
        headers: { "X-Total-Count": "17" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("count: 3 of 17 total");
    expect(lines[1]).toBe("issues[3]{number,title,state,author,created}:");
    expect(lines[2]).toMatch(/^ {2}42,"Fix login redirect loop, please",open,alexion,\d+(mo|[smhdy]) ago$/);
    expect(lines[3]).toMatch(/^ {2}41,Add dark mode,open,contributor,\d+(mo|[smhdy]) ago$/);
    expect(lines[4]).toMatch(/^ {2}38,"Docs: document the release process",open,alexion,\d+(mo|[smhdy]) ago$/);
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("passes type=issues on every issues-list API call", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, query: { type: "issues" }, body: [] },
    ]);
    await runCliTest(["issue", "list"], { env: testModeEnv(server.url) });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.query.type).toBe("issues");
  });

  it("sends the token as a bearer Authorization header", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list"], { env: testModeEnv(server.url) });

    expect(server.requests[0]!.headers.authorization).toBe("Bearer test-token");
  });

  it("passes --state and --limit through to the API", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        query: { state: "closed", limit: "5" },
        headers: { "X-Total-Count": "1" },
        fixture: "issues-closed.json",
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--state", "closed", "--limit", "5"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 1 of 1 total");
    expect(stdout).toContain("37,Crash on empty config,closed,contributor");
  });

  it("defaults to state=open and limit=30", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list"], { env: testModeEnv(server.url) });

    expect(server.requests[0]!.query.state).toBe("open");
    expect(server.requests[0]!.query.limit).toBe("30");
  });

  it("emits an explicit empty state with a next-step suggestion", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "0" },
        body: [],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 0 of 0 total");
    expect(stdout).toContain("issues[0]: (none)");
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("suggests raising --limit when more issues exist than were shown", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        query: { limit: "3" },
        headers: { "X-Total-Count": "17" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout } = await runCliTest(["issue", "list", "--limit", "3"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("issue list --limit <n>");
  });

  it("rejects an invalid --state value with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--state", "banana"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects an invalid --limit value with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--limit", "0"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
  });

  it("rejects unknown flags with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--frobnicate"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("--frobnicate");
  });

  it("rejects unknown issue subcommands with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "destroy"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
  });
});
