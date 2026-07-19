import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const SEARCH_PATH = "/api/v1/repos/issues/search";

/** The current repo the test env is pinned to; results must carry it to survive the client-side filter. */
const CURRENT_REPO = {
  id: 1,
  name: "testrepo",
  owner: "testowner",
  full_name: "testowner/testrepo",
};

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

/**
 * A cross-repo search result, Issue-shaped like `issue list` results. The
 * `repository` field defaults to the current repo so the result passes the
 * client-side repo filter; `number` doubles as the identity asserted on.
 */
function searchIssueOf(
  number: number,
  options: {
    title?: string;
    author?: string;
    repository?: unknown;
    body?: string;
    labels?: { id: number; name: string }[];
    milestone?: { title: string } | null;
    closed_at?: string | null;
  } = {},
): Record<string, unknown> {
  return {
    id: 1000 + number,
    number,
    title: options.title ?? `Issue ${number}`,
    body: options.body ?? "",
    state: "open",
    comments: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: options.closed_at ?? null,
    html_url: `http://gitea.example/testowner/testrepo/issues/${number}`,
    user: { id: 7, login: options.author ?? "alexion" },
    labels: options.labels ?? [],
    milestone: options.milestone ?? null,
    assignees: null,
    pull_request: null,
    repository: options.repository ?? CURRENT_REPO,
  };
}

describe("search issues", () => {
  it("queries the search endpoint with type=issues and owner, then renders repo results", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        query: { q: "login bug", type: "issues", owner: "testowner" },
        headers: { "X-Total-Count": "2" },
        body: [
          searchIssueOf(42, { title: "Fix login redirect loop", author: "alexion" }),
          searchIssueOf(41, { title: "Login button unresponsive", author: "contributor" }),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["search", "issues", "login bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);

    const lines = stdout.split("\n");
    expect(lines).toContain("count: 2 of 2 total");
    expect(lines).toContain("issues[2]{number,title,state,author,created}:");
    expect(stdout).toMatch(/^ {2}42,Fix login redirect loop,open,alexion,\d+(mo|[smhdy]) ago$/m);
    expect(stdout).toMatch(/^ {2}41,Login button unresponsive,open,contributor,\d+(mo|[smhdy]) ago$/m);
    expect(stdout).toMatch(/^help\[\d+\]:/m);

    expect(server.requests[0]!.query.type).toBe("issues");
    expect(server.requests[0]!.query.owner).toBe("testowner");
    expect(server.requests[0]!.query.q).toBe("login bug");
  });
});

describe("search prs", () => {
  it("queries the search endpoint with type=pulls and owner, then renders repo results", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        query: { q: "flaky ci", type: "pulls", owner: "testowner" },
        headers: { "X-Total-Count": "1" },
        body: [searchIssueOf(73, { title: "Retry flaky CI jobs", author: "contributor" })],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["search", "prs", "flaky ci"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);

    const lines = stdout.split("\n");
    expect(lines).toContain("count: 1 of 1 total");
    expect(lines).toContain("pull_requests[1]{number,title,state,author,created}:");
    expect(stdout).toMatch(/^ {2}73,Retry flaky CI jobs,open,contributor,\d+(mo|[smhdy]) ago$/m);
    expect(stdout).toMatch(/^help\[\d+\]:/m);

    expect(server.requests[0]!.query.type).toBe("pulls");
    expect(server.requests[0]!.query.owner).toBe("testowner");
    expect(server.requests[0]!.query.q).toBe("flaky ci");
  });
});

describe("search issues cross-repo filtering", () => {
  it("drops results from other repos and counts only the filtered set", async () => {
    const OTHER_REPO = {
      id: 9,
      name: "otherrepo",
      owner: "otherowner",
      full_name: "otherowner/otherrepo",
    };
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        query: { q: "login bug", type: "issues", owner: "testowner" },
        // The unfiltered, cross-repo total the endpoint reports — misleading once
        // the client-side repo filter runs, so the command must ignore it.
        headers: { "X-Total-Count": "50" },
        body: [
          searchIssueOf(42, { title: "Fix login redirect loop" }),
          searchIssueOf(88, { title: "Login bug in other repo", repository: OTHER_REPO }),
          searchIssueOf(41, { title: "Login button unresponsive" }),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["search", "issues", "login bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);

    const renderedNumbers = [...stdout.matchAll(/^ {2}(\d+),/gm)].map((match) => Number(match[1]));
    expect(renderedNumbers).toEqual([42, 41]);

    const lines = stdout.split("\n");
    expect(lines).toContain("count: 2 of 2 total");
    expect(stdout).not.toContain("of 50 total");
  });
});

describe("search missing query", () => {
  it("rejects a missing query with VALIDATION_ERROR and no network call", async () => {
    server = await startFixtureServer([]);

    const issues = await runCliTest(["search", "issues"], {
      env: testModeEnv(server.url),
    });
    const prs = await runCliTest(["search", "prs"], {
      env: testModeEnv(server.url),
    });

    for (const result of [issues, prs]) {
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("code: VALIDATION_ERROR");
    }
    expect(server.requests).toHaveLength(0);
  });
});

describe("search issues --state", () => {
  it("forwards --state to the state query param", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, body: [] },
    ]);

    const { exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--state", "closed"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(server.requests[0]!.query.state).toBe("closed");
  });

  it("defaults the state param to open when no flag is given", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, body: [] },
    ]);

    await runCliTest(["search", "issues", "login bug"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.state).toBe("open");
  });

  it("rejects an out-of-set --state value with VALIDATION_ERROR and no request", async () => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--state", "banana"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });
});

describe("search issues --label", () => {
  it("passes comma-separated label names straight through, with no label lookup", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, body: [] },
    ]);

    const { exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--label", "bug,urgent"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    // Names go straight to the endpoint's `labels` param — no name→id resolution.
    expect(server.requests[0]!.query.labels).toBe("bug,urgent");
    // The endpoint takes names directly, so there is no /labels lookup call.
    expect(server.requests.every((request) => request.path === SEARCH_PATH)).toBe(true);
  });

  it("omits the labels param when no --label flag is given", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, body: [] },
    ]);

    await runCliTest(["search", "issues", "login bug"], {
      env: testModeEnv(server.url),
    });

    expect(server.requests[0]!.query.labels).toBeUndefined();
  });
});

describe("search issues --limit", () => {
  it("caps the shown rows at --limit while the count total keeps the full filtered size", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        body: [
          searchIssueOf(42),
          searchIssueOf(41),
          searchIssueOf(40),
          searchIssueOf(39),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--limit", "2"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);

    const renderedNumbers = [...stdout.matchAll(/^ {2}(\d+),/gm)].map((match) => Number(match[1]));
    expect(renderedNumbers).toHaveLength(2);

    // Shown 2, filtered total 4 — the cap trims N, not T (ADR 0005).
    expect(stdout.split("\n")).toContain("count: 2 of 4 total");
  });

  it("rejects a non-numeric --limit with VALIDATION_ERROR and no request", async () => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--limit", "abc"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });
});

describe("search issues --fields", () => {
  it("appends the requested extras onto the default locator schema", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        body: [
          searchIssueOf(42, {
            title: "Fix login redirect loop",
            labels: [{ id: 1, name: "bug" }],
            milestone: { title: "v1.0" },
          }),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--fields", "labels,url"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout.split("\n")).toContain(
      "issues[1]{number,title,state,author,created,labels,url}:",
    );

    const row = stdout.split("\n").find((line) => line.startsWith("  42,"))!;
    expect(row).toContain("bug");
    expect(row).toContain("http://gitea.example/testowner/testrepo/issues/42");
  });

  it("applies the body-truncation ruling to a match body, and --full suppresses it", async () => {
    // Truncated inline at 500 chars with the hint.
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        body: [searchIssueOf(42, { body: "x".repeat(650) })],
      },
    ]);
    const truncated = await runCliTest(
      ["search", "issues", "login", "--fields", "body"],
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
        method: "GET",
        path: SEARCH_PATH,
        body: [searchIssueOf(42, { body: "x".repeat(650) })],
      },
    ]);
    const full = await runCliTest(
      ["search", "issues", "login", "--fields", "body", "--full"],
      { env: testModeEnv(server.url) },
    );

    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("x".repeat(650));
    expect(full.stdout).not.toContain("truncated");
  });

  it("rejects an unknown --fields name with VALIDATION_ERROR", async () => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug", "--fields", "bogus"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("bogus");
    expect(server.requests).toHaveLength(0);
  });
});

describe("search empty results", () => {
  const cases: { subcommand: string; noun: string }[] = [
    { subcommand: "issues", noun: "issues" },
    { subcommand: "prs", noun: "pull_requests" },
  ];

  for (const { subcommand, noun } of cases) {
    it(`emits the standard ${noun}[0]: (none) empty state`, async () => {
      server = await startFixtureServer([
        { method: "GET", path: SEARCH_PATH, headers: { "X-Total-Count": "0" }, body: [] },
      ]);

      const { stdout, exitCode } = await runCliTest(
        ["search", subcommand, "login bug"],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`${noun}[0]: (none)`);
      expect(stdout).toContain("count: 0 of 0 total");
      expect(stdout).toMatch(/^help\[\d+\]:/m);
    });
  }
});

/**
 * The `help[1]:` next-step line is emitted by `suggestCommand`, so it appears
 * wrapped in a `Run \`gitea-axi …\`` line with `-R`/`--login` normalization.
 * These tests pull that help block out of the output and assert on the
 * count-conditional suggestion within it.
 */
function helpBlock(stdout: string): string {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => /^help\[\d+\]:/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  // The block runs from the help[N]: header to the next blank line / EOF.
  const rest = lines.slice(start);
  const end = rest.findIndex((line, i) => i > 0 && line.trim() === "");
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("search issues count-conditional next-step suggestion", () => {
  it("suggests the list fallback when there are zero in-repo matches", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, headers: { "X-Total-Count": "0" }, body: [] },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("issue list --state all");
    expect(help).toContain("to list all issues instead");
    expect(help).not.toContain("issue view");
  });

  it("fills the real number when there is exactly one in-repo match", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        headers: { "X-Total-Count": "1" },
        body: [searchIssueOf(2, { title: "Fix login redirect loop" })],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("issue view 2");
    expect(help).toContain("to see it in full");
    expect(help).not.toContain("issue view <number>");
  });

  it("keeps the <number> placeholder when there are two or more in-repo matches", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        headers: { "X-Total-Count": "2" },
        body: [
          searchIssueOf(42, { title: "Fix login redirect loop" }),
          searchIssueOf(41, { title: "Login button unresponsive" }),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "issues", "login bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("issue view <number>");
    expect(help).toContain("to see a match in full");
  });
});

describe("search prs count-conditional next-step suggestion", () => {
  it("suggests the list fallback when there are zero in-repo matches", async () => {
    server = await startFixtureServer([
      { method: "GET", path: SEARCH_PATH, headers: { "X-Total-Count": "0" }, body: [] },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "prs", "flaky ci"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("pr list --state all");
    expect(help).toContain("to list all pull requests instead");
    expect(help).not.toContain("pr view");
  });

  it("fills the real number when there is exactly one in-repo match", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        headers: { "X-Total-Count": "1" },
        body: [searchIssueOf(2, { title: "Retry flaky CI jobs" })],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "prs", "flaky ci"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("pr view 2");
    expect(help).toContain("to see it in full");
    expect(help).not.toContain("pr view <number>");
  });

  it("keeps the <number> placeholder when there are two or more in-repo matches", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: SEARCH_PATH,
        headers: { "X-Total-Count": "2" },
        body: [
          searchIssueOf(73, { title: "Retry flaky CI jobs" }),
          searchIssueOf(72, { title: "Stabilize CI runners" }),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(
      ["search", "prs", "flaky ci"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const help = helpBlock(stdout);
    expect(help).toContain("pr view <number>");
    expect(help).toContain("to see a match in full");
  });
});
