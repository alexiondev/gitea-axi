import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureRoute, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const PULLS_PATH = "/api/v1/repos/testowner/testrepo/pulls";
const LABELS_PATH = "/api/v1/repos/testowner/testrepo/labels";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

interface PullOptions {
  title?: string;
  state?: string;
  draft?: boolean;
  author?: string;
  base?: string;
  head?: string;
  assignees?: { login: string }[] | null;
  labels?: { id: number; name: string }[];
  milestone?: { title: string } | null;
  body?: string;
  created_at?: string;
  merged_at?: string | null;
}

/** A pull request shaped like Gitea's, with only the fields the list path reads. */
function pullOf(number: number, options: PullOptions = {}): Record<string, unknown> {
  return {
    id: 1000 + number,
    number,
    title: options.title ?? `PR ${number}`,
    state: options.state ?? "open",
    draft: options.draft ?? false,
    user: { id: 7, login: options.author ?? "alexion" },
    base: { ref: options.base ?? "main" },
    head: { ref: options.head ?? `feature-${number}` },
    assignees: options.assignees ?? null,
    labels: options.labels ?? [],
    milestone: options.milestone ?? null,
    body: options.body ?? "",
    created_at: options.created_at ?? "2026-07-01T00:00:00Z",
    merged_at: options.merged_at ?? null,
    html_url: `http://gitea.example/testowner/testrepo/pulls/${number}`,
    url: `http://gitea.example/api/v1/repos/testowner/testrepo/pulls/${number}`,
  };
}

interface ReviewOptions {
  official?: boolean;
  stale?: boolean;
  dismissed?: boolean;
  user?: string;
}

function reviewOf(state: string, options: ReviewOptions = {}): Record<string, unknown> {
  return {
    id: 1,
    state,
    official: options.official ?? false,
    stale: options.stale ?? false,
    dismissed: options.dismissed ?? false,
    user: { login: options.user ?? "reviewer" },
  };
}

/** The reviews-list route a rendered PR triggers (one fetch per PR, ADR 0006). */
function reviewsRoute(number: number, reviews: Record<string, unknown>[]): FixtureRoute {
  return { method: "GET", path: `${PULLS_PATH}/${number}/reviews`, body: reviews };
}

/** The single rendered data row, split on commas. */
function dataRow(stdout: string): string[] {
  const row = stdout.split("\n").find((line) => /^ {2}\d+,/.test(line));
  expect(row, "expected a rendered pull_requests row").toBeDefined();
  return row!.trim().split(",");
}

/** The `review` column of a single-PR, default-fields render (its last column). */
function reviewColumn(stdout: string): string {
  const parts = dataRow(stdout);
  return parts[parts.length - 1]!;
}

/** The `number` column of every rendered row, in output order. */
function renderedNumbers(stdout: string): number[] {
  return stdout
    .split("\n")
    .filter((line) => /^ {2}\d+,/.test(line))
    .map((line) => Number(line.trim().split(",")[0]));
}

describe("pr list", () => {
  it("renders the default fields with a review column and a count line", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { state: "open", limit: "30", page: "1" },
        headers: { "X-Total-Count": "9" },
        body: [
          pullOf(7, { title: "Add search", author: "alexion", draft: false }),
          pullOf(8, { title: "Draft work", author: "contributor", draft: true }),
        ],
      },
      reviewsRoute(7, [reviewOf("APPROVED")]),
      reviewsRoute(8, []),
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("count: 2 of 9 total");
    expect(lines[1]).toBe("pull_requests[2]{number,title,state,author,draft,review}:");
    expect(lines[2]).toBe("  7,Add search,open,alexion,no,approved");
    expect(lines[3]).toBe("  8,Draft work,open,contributor,yes,required");
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("defaults to state=open, limit=30 and page=1", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
    ]);
    await runCliTest(["pr", "list"], { env: testModeEnv(server.url) });

    expect(server.requests[0]!.query.state).toBe("open");
    expect(server.requests[0]!.query.limit).toBe("30");
    expect(server.requests[0]!.query.page).toBe("1");
  });

  it("emits an explicit empty state with a create suggestion", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, headers: { "X-Total-Count": "0" }, body: [] },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 0 of 0 total");
    expect(stdout).toContain("pull_requests[0]: (none)");
    expect(stdout).toContain("gitea-axi pr create");
  });
});

describe("pr list reviewDecision", () => {
  const cases: { name: string; reviews: Record<string, unknown>[]; expected: string }[] = [
    { name: "a fresh approval renders approved", reviews: [reviewOf("APPROVED")], expected: "approved" },
    {
      name: "a change request renders changes_requested",
      reviews: [reviewOf("REQUEST_CHANGES")],
      expected: "changes_requested",
    },
    { name: "zero reviews render required", reviews: [], expected: "required" },
    {
      name: "a comment-only review renders required",
      reviews: [reviewOf("COMMENT")],
      expected: "required",
    },
    {
      name: "a stale approval renders required",
      reviews: [reviewOf("APPROVED", { stale: true })],
      expected: "required",
    },
    {
      name: "a dismissed approval renders required",
      reviews: [reviewOf("APPROVED", { dismissed: true })],
      expected: "required",
    },
    {
      name: "a change request beats an approval in the same set",
      reviews: [reviewOf("APPROVED"), reviewOf("REQUEST_CHANGES")],
      expected: "changes_requested",
    },
  ];

  for (const { name, reviews, expected } of cases) {
    it(name, async () => {
      server = await startFixtureServer([
        { method: "GET", path: PULLS_PATH, headers: { "X-Total-Count": "1" }, body: [pullOf(7)] },
        reviewsRoute(7, reviews),
      ]);
      const { stdout, exitCode } = await runCliTest(["pr", "list"], {
        env: testModeEnv(server.url),
      });

      expect(exitCode).toBe(0);
      expect(reviewColumn(stdout)).toBe(expected);
    });
  }

  it("considers only official reviews when any review is official", async () => {
    // An official approval outranks an unofficial change request: under branch
    // protection only official reviews count (ADR 0006 official-first fallback).
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, headers: { "X-Total-Count": "1" }, body: [pullOf(7)] },
      reviewsRoute(7, [
        reviewOf("APPROVED", { official: true }),
        reviewOf("REQUEST_CHANGES", { official: false }),
      ]),
    ]);
    const { stdout } = await runCliTest(["pr", "list"], { env: testModeEnv(server.url) });

    expect(reviewColumn(stdout)).toBe("approved");
  });

  it("lets an unofficial approval count when no review is official", async () => {
    // Unprotected repos never mark a review official; without the fallback the
    // approval would be ignored and the PR would read required forever.
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, headers: { "X-Total-Count": "1" }, body: [pullOf(7)] },
      reviewsRoute(7, [reviewOf("APPROVED", { official: false })]),
    ]);
    const { stdout } = await runCliTest(["pr", "list"], { env: testModeEnv(server.url) });

    expect(reviewColumn(stdout)).toBe("approved");
  });
});

describe("pr list --label", () => {
  it("resolves a label name to its ID case-insensitively before the list call", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 4, name: "Bug" }] },
      { method: "GET", path: PULLS_PATH, query: { labels: "4" }, body: [] },
    ]);
    const { exitCode } = await runCliTest(["pr", "list", "--label", "bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const pullsRequest = server.requests.find((request) => request.path === PULLS_PATH)!;
    expect(pullsRequest.query.labels).toBe("4");
  });

  it("rejects an unknown label name with VALIDATION_ERROR and no list call", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 4, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "list", "--label", "nope"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests.some((request) => request.path === PULLS_PATH)).toBe(false);
  });

  it("passes --label-id straight through, skipping the label lookup", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, query: { labels: "5" }, body: [] },
    ]);
    const { exitCode } = await runCliTest(["pr", "list", "--label-id", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(server.requests.some((request) => request.path === LABELS_PATH)).toBe(false);
    expect(server.requests[0]!.query.labels).toBe("5");
  });
});

describe("pr list --author and --sort", () => {
  it("maps --author to the poster param", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
    ]);
    await runCliTest(["pr", "list", "--author", "octocat"], { env: testModeEnv(server.url) });

    expect(server.requests[0]!.query.poster).toBe("octocat");
  });

  it("passes each of the six Gitea sort values straight to the API", async () => {
    const sorts = [
      "oldest",
      "recentupdate",
      "leastupdate",
      "mostcomment",
      "leastcomment",
      "priority",
    ];
    for (const sort of sorts) {
      const local = await startFixtureServer([
        { method: "GET", path: PULLS_PATH, body: [] },
      ]);
      const { exitCode } = await runCliTest(["pr", "list", "--sort", sort], {
        env: testModeEnv(local.url),
      });

      expect(exitCode).toBe(0);
      expect(local.requests[0]!.query.sort).toBe(sort);
      await local.close();
    }
    // afterEach closes `server`; give it a live handle to release.
    server = await startFixtureServer([]);
  });

  it("rejects an invalid --sort value with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "list", "--sort", "banana"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });
});

describe("pr list client-side filters", () => {
  it("filters --draft after full pagination, with the count from the filtered set", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { page: "1", limit: "50" },
        headers: { "X-Total-Count": "3" },
        body: [
          pullOf(7, { draft: true }),
          pullOf(8, { draft: false }),
          pullOf(9, { draft: true }),
        ],
      },
      reviewsRoute(7, []),
      reviewsRoute(9, []),
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "list", "--draft"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(renderedNumbers(stdout)).toEqual([7, 9]);
    // Two drafts of three PRs: T is the filtered set's own size, not X-Total-Count.
    expect(stdout).toContain("count: 2 of 2 total");
    // Reviews were fetched only for the PRs that survived the filter.
    expect(server.requests.some((request) => request.path === `${PULLS_PATH}/8/reviews`)).toBe(false);
  });

  it("filters --base against the base branch ref", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { page: "1", limit: "50" },
        body: [
          pullOf(7, { base: "main" }),
          pullOf(8, { base: "release" }),
          pullOf(9, { base: "main" }),
        ],
      },
      reviewsRoute(7, []),
      reviewsRoute(9, []),
    ]);
    const { stdout } = await runCliTest(["pr", "list", "--base", "main"], {
      env: testModeEnv(server.url),
    });

    expect(renderedNumbers(stdout)).toEqual([7, 9]);
    expect(stdout).toContain("count: 2 of 2 total");
  });

  it("filters --head against the head branch ref", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { page: "1", limit: "50" },
        body: [
          pullOf(7, { head: "feature-x" }),
          pullOf(8, { head: "feature-y" }),
        ],
      },
      reviewsRoute(8, []),
    ]);
    const { stdout } = await runCliTest(["pr", "list", "--head", "feature-y"], {
      env: testModeEnv(server.url),
    });

    expect(renderedNumbers(stdout)).toEqual([8]);
    expect(stdout).toContain("count: 1 of 1 total");
  });

  it("filters --assignee against assignee logins, case-insensitively", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { page: "1", limit: "50" },
        body: [
          pullOf(7, { assignees: [{ login: "Alexion" }] }),
          pullOf(8, { assignees: [{ login: "contributor" }] }),
          pullOf(9, { assignees: null }),
        ],
      },
      reviewsRoute(7, []),
    ]);
    const { stdout } = await runCliTest(["pr", "list", "--assignee", "alexion"], {
      env: testModeEnv(server.url),
    });

    expect(renderedNumbers(stdout)).toEqual([7]);
    expect(stdout).toContain("count: 1 of 1 total");
  });

  it("caps the filtered set at --limit while reporting the full filtered total", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        query: { page: "1", limit: "50" },
        body: [
          pullOf(7, { draft: true }),
          pullOf(8, { draft: true }),
          pullOf(9, { draft: true }),
        ],
      },
      reviewsRoute(7, []),
      reviewsRoute(8, []),
    ]);
    const { stdout } = await runCliTest(["pr", "list", "--draft", "--limit", "2"], {
      env: testModeEnv(server.url),
    });

    expect(renderedNumbers(stdout)).toEqual([7, 8]);
    expect(stdout).toContain("count: 2 of 3 total");
  });
});

describe("pr list --fields", () => {
  it("appends the selected extra fields, each via its extractor", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        headers: { "X-Total-Count": "1" },
        body: [
          pullOf(7, {
            body: "Raw body text.",
            labels: [{ id: 1, name: "bug" }],
            milestone: { title: "v1.0" },
            merged_at: "2026-07-05T00:00:00Z",
          }),
        ],
      },
      reviewsRoute(7, [reviewOf("APPROVED")]),
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["pr", "list", "--fields", "body,createdAt,labels,milestone,mergedAt,url"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "pull_requests[1]{number,title,state,author,draft,review,body,created,labels,milestone,merged_at,url}:",
    );
    const row = stdout.split("\n").find((line) => line.startsWith("  7,"))!;
    expect(row).toContain("Raw body text.");
    expect(row).toContain("v1.0");
    expect(row).toContain("http://gitea.example/testowner/testrepo/pulls/7");
    expect(row).toMatch(/\d+(mo|[smhdy]) ago/);
  });

  it("rejects an unknown --fields name with exit code 2", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "list", "--fields", "bogus"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("bogus");
    expect(server.requests).toHaveLength(0);
  });
});

describe("pr list --search", () => {
  it("forbids --search, redirecting to search prs", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["pr", "list", "--search", "login bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("gitea-axi search prs");
    expect(server.requests).toHaveLength(0);
  });

  it("forbids --search in its inline and bare forms too", async () => {
    server = await startFixtureServer([]);
    const inline = await runCliTest(["pr", "list", "--search=login"], {
      env: testModeEnv(server.url),
    });
    const bare = await runCliTest(["pr", "list", "--search"], {
      env: testModeEnv(server.url),
    });

    for (const result of [inline, bare]) {
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("gitea-axi search prs");
    }
    expect(server.requests).toHaveLength(0);
  });
});
