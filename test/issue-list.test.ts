import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

/**
 * A synthetic issue, for the sort and pagination cases where what matters is the
 * ordering keys rather than realistic content. `number` doubles as the identity
 * asserted on in the rendered output.
 */
function issueOf(
  number: number,
  keys: { created?: string; updated?: string; comments?: number } = {},
): Record<string, unknown> {
  return {
    id: 1000 + number,
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    comments: keys.comments ?? 0,
    created_at: keys.created ?? "2026-01-01T00:00:00Z",
    updated_at: keys.updated ?? "2026-01-01T00:00:00Z",
    html_url: `http://gitea.example/testowner/testrepo/issues/${number}`,
    user: { id: 7, login: "alexion" },
    labels: [],
    milestone: null,
    assignees: null,
    pull_request: null,
  };
}

/** The `number` column of every rendered row, in output order. */
function renderedNumbers(stdout: string): number[] {
  return stdout
    .split("\n")
    .filter((line) => /^ {2}\d+,/.test(line))
    .map((line) => Number(line.trim().split(",")[0]));
}

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

  it("emits no type field, since Gitea has no issue types", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, fixture: "issues-open.json" },
    ]);
    const { stdout } = await runCliTest(["issue", "list"], { env: testModeEnv(server.url) });

    expect(stdout).toContain("issues[3]{number,title,state,author,created}:");
    expect(stdout).not.toContain("type");
  });
});

describe("issue list filters", () => {
  it("maps --label to the labels query param, passing names through", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list", "--label", "bug,documentation"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.labels).toBe("bug,documentation");
  });

  it("maps --assignee to assigned_by", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list", "--assignee", "alexion"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.assigned_by).toBe("alexion");
  });

  it("maps --author to created_by", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list", "--author", "contributor"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.created_by).toBe("contributor");
  });

  it("maps --milestone to milestones", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);
    await runCliTest(["issue", "list", "--milestone", "v1.0"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.milestones).toBe("v1.0");
  });

  it("filters server-side: every filter travels in one request alongside type=issues", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        query: {
          labels: "bug",
          assigned_by: "alexion",
          created_by: "contributor",
          milestones: "v1.0",
          type: "issues",
        },
        headers: { "X-Total-Count": "1" },
        body: [],
      },
    ]);
    const { exitCode } = await runCliTest(
      [
        "issue", "list",
        "--label", "bug",
        "--assignee", "alexion",
        "--author", "contributor",
        "--milestone", "v1.0",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(server.requests).toHaveLength(1);
  });
});

describe("issue list --sort", () => {
  it("reorders by updated descending, client-side", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "3" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--sort", "updated"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    // Fixture order is 42, 41, 38; by updated_at it is 42 (Jul 8), 38 (Jul 1), 41 (Jun 20).
    expect(renderedNumbers(stdout)).toEqual([42, 38, 41]);
  });

  it("reorders by comments descending, client-side", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "3" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout } = await runCliTest(["issue", "list", "--sort", "comments"], {
      env: testModeEnv(server.url),
    });

    // Comment counts: 42 has 2, 41 has 0, 38 has 5.
    expect(renderedNumbers(stdout)).toEqual([38, 42, 41]);
  });

  it("reorders by created descending, client-side", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "3" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout } = await runCliTest(["issue", "list", "--sort", "created"], {
      env: testModeEnv(server.url),
    });

    expect(renderedNumbers(stdout)).toEqual([42, 41, 38]);
  });

  it("paginates fully before sorting, so a later page can outrank the first", async () => {
    // Page 1 is a full page of stale issues; the freshest issue of all sits on
    // page 2, so it can only lead the output if pagination completed first.
    const page1 = Array.from({ length: 50 }, (_, i) =>
      issueOf(100 + i, { updated: "2026-01-01T00:00:00Z" }),
    );
    const page2 = [
      issueOf(7, { updated: "2026-07-09T00:00:00Z" }),
      issueOf(8, { updated: "2026-03-01T00:00:00Z" }),
    ];
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        query: { page: "1", limit: "50" },
        headers: { "X-Total-Count": "52" },
        body: page1,
      },
      {
        method: "GET",
        path: ISSUES_PATH,
        query: { page: "2", limit: "50" },
        headers: { "X-Total-Count": "52" },
        body: page2,
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--sort", "updated"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(server.requests).toHaveLength(2);
    expect(renderedNumbers(stdout)[0]).toBe(7);
    // The count line keeps T from X-Total-Count: sorting reorders without
    // changing membership, so the unfiltered total stays accurate (ADR 0005).
    expect(stdout).toContain("count: 30 of 52 total");
  });

  it("applies --limit to the sorted order, not to the fetched pages", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "17" },
        fixture: "issues-open.json",
      },
    ]);
    const { stdout } = await runCliTest(
      ["issue", "list", "--sort", "comments", "--limit", "2"],
      { env: testModeEnv(server.url) },
    );

    expect(renderedNumbers(stdout)).toEqual([38, 42]);
    expect(stdout).toContain("count: 2 of 17 total");
    // Pagination reads full pages regardless of --limit; the cap is applied after sorting.
    expect(server.requests[0]!.query.limit).toBe("50");
  });

  it("reports the paginated set's own size when the instance omits X-Total-Count", async () => {
    // Everything was fetched to sort it, so the total is known even with no
    // header — the bare `count: N` form must never appear (Principle 4).
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, fixture: "issues-open.json" },
    ]);
    const { stdout } = await runCliTest(["issue", "list", "--sort", "updated", "--limit", "2"], {
      env: testModeEnv(server.url),
    });

    expect(stdout).toContain("count: 2 of 3 total");
  });

  it("stops at the page cap when a server keeps returning full pages", async () => {
    // A server that ignores paging would otherwise loop forever.
    const fullPage = Array.from({ length: 50 }, (_, i) => issueOf(100 + i));
    server = await startFixtureServer([
      { method: "GET", path: ISSUES_PATH, headers: { "X-Total-Count": "9999" }, body: fullPage },
    ]);
    const { exitCode } = await runCliTest(["issue", "list", "--sort", "created"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(server.requests).toHaveLength(20);
  });

  it("rejects an invalid --sort value with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--sort", "banana"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });
});

describe("issue list --fields", () => {
  it("appends the selected extra fields, each via its extractor", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "1" },
        fixture: "issues-fields.json",
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      [
        "issue", "list",
        "--state", "closed",
        "--fields", "body,closedAt,labels,milestone,updatedAt,url",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "issues[1]{number,title,state,author,created,body,closedAt,labels,milestone,updatedAt,url}:",
    );
    const row = stdout.split("\n").find((line) => line.startsWith("  50,"))!;
    expect(row).toContain("Raw body text, kept whole by the body field.");
    expect(row).toContain('"bug, priority: high"');
    expect(row).toContain("v1.0");
    expect(row).toContain("http://gitea.example/testowner/testrepo/issues/50");
    // closedAt and updatedAt render as relative times, like `created`.
    expect(row).toMatch(/\d+(mo|[smhdy]) ago/);
  });

  it("truncates an over-limit body inline, appending the same hint as issue view", async () => {
    const fullBody = "x".repeat(650);
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "1" },
        body: [{ ...issueOf(50), body: fullBody }],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--fields", "body"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("x".repeat(500));
    expect(stdout).toContain(
      "... (truncated, 650 chars total - use --full to see complete body)",
    );
    expect(stdout).not.toContain("x".repeat(650));
  });

  it("returns the complete body untruncated under --full, with no truncation hint", async () => {
    const fullBody = "x".repeat(650);
    server = await startFixtureServer([
      {
        method: "GET",
        path: ISSUES_PATH,
        headers: { "X-Total-Count": "1" },
        body: [{ ...issueOf(50), body: fullBody }],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--fields", "body", "--full"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("x".repeat(650));
    expect(stdout).not.toContain("truncated");
  });

  it("rejects an unknown --fields name with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--fields", "bogus"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("bogus");
    expect(server.requests).toHaveLength(0);
  });
});

describe("issue list --search", () => {
  it("forbids --search, redirecting to search issues", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--search", "login bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    // TOON escapes the quotes around <query> inside the help string.
    expect(stdout).toContain("gitea-axi search issues");
    expect(stdout).toContain("<query>");
    expect(server.requests).toHaveLength(0);
  });

  it("forbids --search in its inline and bare forms too", async () => {
    server = await startFixtureServer([]);
    const inline = await runCliTest(["issue", "list", "--search=login"], {
      env: testModeEnv(server.url),
    });
    const bare = await runCliTest(["issue", "list", "--search"], {
      env: testModeEnv(server.url),
    });

    for (const result of [inline, bare]) {
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("gitea-axi search issues");
    }
    expect(server.requests).toHaveLength(0);
  });
});
