import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureRoute, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";
const PULLS_PATH = "/api/v1/repos/testowner/testrepo/pulls";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

/** A pull request shaped like Gitea's, with only the fields the dashboard reads. */
function pullOf(number: number, title: string, author: string): Record<string, unknown> {
  return {
    id: 1000 + number,
    number,
    title,
    state: "open",
    user: { id: 7, login: author },
  };
}

/** An issue shaped like Gitea's, with only the fields the dashboard reads. */
function issueOf(number: number, title: string, author: string): Record<string, unknown> {
  return {
    id: 2000 + number,
    number,
    title,
    state: "open",
    user: { id: 7, login: author },
  };
}

function reviewOf(state: string): Record<string, unknown> {
  return {
    id: 1,
    state,
    official: false,
    stale: false,
    dismissed: false,
    user: { login: "reviewer" },
  };
}

/** The reviews-list route a rendered PR triggers (one fetch per PR). */
function reviewsRoute(number: number, reviews: Record<string, unknown>[]): FixtureRoute {
  return { method: "GET", path: `${PULLS_PATH}/${number}/reviews`, body: reviews };
}

describe("bare dashboard", () => {
  it("renders the header, repo line, PRs with computed review, issues, and a --full hint", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        body: [
          pullOf(5, "Add search", "alexion"),
          pullOf(6, "Fix crash", "contributor"),
        ],
      },
      {
        method: "GET",
        path: ISSUES_PATH,
        body: [
          issueOf(3, "Login loops", "alexion"),
          issueOf(4, "Dark mode", "contributor"),
        ],
      },
      reviewsRoute(5, [reviewOf("APPROVED")]),
      reviewsRoute(6, []),
    ]);

    const { stdout, exitCode } = await runCliTest([], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);

    // Header and repo line.
    expect(stdout).toMatch(/^bin:/m);
    expect(stdout).toContain("repo: testowner/testrepo");

    // PR block: computed review renders approved for PR 5, required for PR 6.
    const lines = stdout.split("\n");
    const prHeaderIndex = lines.indexOf("prs[2]{number,title,author,review}:");
    expect(prHeaderIndex).toBeGreaterThanOrEqual(0);
    const prRows = lines.slice(prHeaderIndex + 1, prHeaderIndex + 3);
    expect(prRows).toEqual([
      "  5,Add search,alexion,approved",
      "  6,Fix crash,contributor,required",
    ]);

    // Issue block: both rows appear under the specified header.
    const issueHeaderIndex = lines.indexOf("issues[2]{number,title,state,author}:");
    expect(issueHeaderIndex).toBeGreaterThanOrEqual(0);
    const issueRows = lines.slice(issueHeaderIndex + 1, issueHeaderIndex + 3);
    expect(issueRows).toEqual([
      "  3,Login loops,open,alexion",
      "  4,Dark mode,open,contributor",
    ]);

    // Help block hints at the full dashboard.
    expect(stdout).toContain("--full");
  });

  it("renders raw empty-state lines when there are no open PRs or issues", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
      { method: "GET", path: ISSUES_PATH, body: [] },
    ]);

    const { stdout, exitCode } = await runCliTest([], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("prs: 0 open");
    expect(stdout).toContain("issues: 0 open");
    // The dashboard uses the raw form, not the list commands' (none) convention.
    expect(stdout).not.toContain("prs[0]: (none)");
    expect(stdout).not.toContain("issues[0]: (none)");
  });

  it("fetches issues with type=issues so PRs never appear in the issue block", async () => {
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
      { method: "GET", path: ISSUES_PATH, body: [issueOf(3, "Login loops", "alexion")] },
    ]);

    const { exitCode } = await runCliTest([], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);
    const issuesRequest = server.requests.find(
      (request) => request.method === "GET" && request.path === ISSUES_PATH,
    );
    expect(issuesRequest, "expected a GET to the issues path").toBeDefined();
    expect(issuesRequest!.query.type).toBe("issues");
  });

  it("renders the --full PR table capped at 20 rows with count: 20 of T total", async () => {
    // 45 open PRs exist (X-Total-Count), but the full tier returns and caps at 20.
    const pulls = Array.from({ length: 20 }, (_, i) => {
      const number = i + 1;
      return {
        id: 1000 + number,
        number,
        title: `PR ${number}`,
        state: "open",
        user: { id: 7, login: "alexion" },
        labels: [{ id: number, name: `label-${number}` }],
      };
    });
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULLS_PATH,
        headers: { "X-Total-Count": "45" },
        body: pulls,
      },
      { method: "GET", path: ISSUES_PATH, body: [] },
      reviewsRoute(1, [reviewOf("APPROVED")]),
      ...Array.from({ length: 19 }, (_, i) => reviewsRoute(i + 2, [])),
    ]);

    const { stdout, exitCode } = await runCliTest(["--full"], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);

    const lines = stdout.split("\n");
    const headerIndex = lines.indexOf("prs[20]{number,title,author,labels,review}:");
    expect(headerIndex, "expected the full-tier PR table header").toBeGreaterThanOrEqual(0);

    // Exactly 20 PR rows render, even though 45 open PRs exist.
    const prRows = lines.filter((line) => /^ {2}\d+,/.test(line));
    expect(prRows).toHaveLength(20);

    // The standard count line sits above the PR block.
    const countIndex = lines.indexOf("count: 20 of 45 total");
    expect(countIndex, "expected the count line").toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeLessThan(headerIndex);

    // PR 1 carries its joined label and its computed review reads approved.
    const firstRow = lines[headerIndex + 1]!;
    expect(firstRow.startsWith("  1,")).toBe(true);
    expect(firstRow).toContain("label-1");
    expect(firstRow.endsWith(",approved")).toBe(true);
  });

  it("groups --full issue counts by label, counting each issue under all its labels", async () => {
    const labeledIssue = (
      number: number,
      labels: { id: number; name: string }[],
    ): Record<string, unknown> => ({
      id: 2000 + number,
      number,
      title: `Issue ${number}`,
      state: "open",
      user: { id: 7, login: "alexion" },
      labels,
    });
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
      {
        method: "GET",
        path: ISSUES_PATH,
        body: [
          labeledIssue(1, [{ id: 10, name: "bug" }]),
          labeledIssue(2, [
            { id: 10, name: "bug" },
            { id: 11, name: "feature" },
          ]),
          labeledIssue(3, [{ id: 11, name: "feature" }]),
          labeledIssue(4, []),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["--full"], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);
    // Each issue is counted under all its labels; the lone unlabeled issue buckets alone.
    expect(stdout).toContain("bug: 2");
    expect(stdout).toContain("feature: 2");
    expect(stdout).toContain("unlabeled: 1");
    // The issues block is a label->count record, not a table.
    expect(stdout).toContain("issues:");
    expect(stdout).not.toContain("issues[");
  });

  it("suffixes --full label counts with + when aggregation hits the 1000-issue cap", async () => {
    // A single full page of 50 bug-labelled issues, served for every page. The
    // CLI keeps paging while pages stay full, stopping at the 20-page cap:
    // 20 * 50 = 1000 aggregated issues, so `bug` reads a capped lower bound.
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      id: 2000 + i,
      number: i + 1,
      title: `Issue ${i + 1}`,
      state: "open",
      user: { id: 7, login: "alexion" },
      labels: [{ id: 1, name: "bug" }],
    }));
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
      { method: "GET", path: ISSUES_PATH, body: fullPage },
    ]);

    const { stdout, exitCode } = await runCliTest(["--full"], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("bug: 1000+");
  });

  it("omits the unlabeled bucket from --full counts when every issue is labelled", async () => {
    const labelledIssue = (
      number: number,
      label: string,
    ): Record<string, unknown> => ({
      id: 2000 + number,
      number,
      title: `Issue ${number}`,
      state: "open",
      user: { id: 7, login: "alexion" },
      labels: [{ id: number, name: label }],
    });
    server = await startFixtureServer([
      { method: "GET", path: PULLS_PATH, body: [] },
      {
        method: "GET",
        path: ISSUES_PATH,
        body: [
          labelledIssue(1, "bug"),
          labelledIssue(2, "feature"),
          labelledIssue(3, "bug"),
        ],
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["--full"], { env: testModeEnv(server.url) });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("bug:");
    expect(stdout).toContain("feature:");
    // No unlabeled issues, so no zero-count bucket is emitted.
    expect(stdout).not.toContain("unlabeled");
  });
});
