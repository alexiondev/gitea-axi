import { encode } from "@toon-format/toon";
import type { Issue, PullRequest } from "gitea-js";
import { createClient, type GiteaClient } from "../client.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { classifyHttpError } from "../errors.js";
import { extractRow, joined, lowercased, pluck, type FieldDef } from "../fields.js";
import { fetchAllPages, readTotalCount, type PaginatedResult } from "../paginate.js";
import { formatCountLine } from "../render.js";
import { fetchReviewDecision, type ReviewDecision } from "../review.js";
import { suggestCommand } from "../suggestions.js";

// The short tier fetches at most this many issues and PRs — gh-axi's home shape
// (ADR 0012). At most 3 extra review fetches follow, keeping the whole tier
// inside the SessionStart hook's timeout.
const SHORT_LIMIT = 3;

// The full tier's open-PR table is capped at this many rows (ADR 0012), each
// costing one review fetch.
const FULL_PR_LIMIT = 20;

// Short-tier PR columns. `review` is not a FieldDef: it comes from a separate
// per-PR reviews fetch (ADR 0006) and is set on each row afterwards.
const SHORT_PR_FIELDS: FieldDef<PullRequest>[] = [
  pluck("number"),
  pluck("title"),
  pluck("author", "user.login"),
];

const SHORT_ISSUE_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
];

// Full-tier PR-table columns; `review` is appended after, as in the short tier.
const FULL_PR_FIELDS: FieldDef<PullRequest>[] = [
  pluck("number"),
  pluck("title"),
  pluck("author", "user.login"),
  joined("labels", "labels", "name"),
];

interface OpenPulls {
  pulls: PullRequest[];
  /** `X-Total-Count` — the repo's open-PR count, for the full tier's count line. */
  total: number | undefined;
}

/** Fetch the first page of open PRs, capped at `limit`. */
async function fetchOpenPulls(
  api: GiteaClient,
  context: RepoContext,
  limit: number,
): Promise<OpenPulls> {
  try {
    const response = await api.repos.repoListPullRequests(context.owner, context.name, {
      state: "open",
      limit,
      page: 1,
    });
    return {
      // A server that ignores `limit` cannot inflate the table past its cap.
      pulls: (response.data ?? []).slice(0, limit),
      total: readTotalCount(response.headers),
    };
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * Every page of open issues up to the 1000-issue cap, always passing
 * `type=issues` (the Issue/PR Type Guard). The result's `capped` flag drives the
 * `+` suffix on the label counts when the cap cut the set short.
 */
async function fetchAllOpenIssues(
  api: GiteaClient,
  context: RepoContext,
): Promise<PaginatedResult<Issue>> {
  try {
    return await fetchAllPages<Issue>((page, limit) =>
      api.repos.issueListIssues(context.owner, context.name, {
        state: "open",
        type: "issues",
        page,
        limit,
      }),
    );
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * Fetch the first page of open issues, capped at `limit`, always passing
 * `type=issues` so pull requests never pollute the issue block (see the
 * Issue/PR Type Guard).
 */
async function fetchOpenIssues(
  api: GiteaClient,
  context: RepoContext,
  limit: number,
): Promise<Issue[]> {
  try {
    const response = await api.repos.issueListIssues(context.owner, context.name, {
      state: "open",
      type: "issues",
      limit,
      page: 1,
    });
    return response.data ?? [];
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * The reviewDecision for each PR, one reviews fetch per PR all in flight at once
 * (ADR 0006). A PR Gitea returned without a number is reported as `required`
 * rather than blocking the whole dashboard on a single malformed entry.
 */
async function pullDecisions(
  api: GiteaClient,
  context: RepoContext,
  pulls: PullRequest[],
): Promise<ReviewDecision[]> {
  return Promise.all(
    pulls.map((pull) =>
      pull.number === undefined
        ? Promise.resolve<ReviewDecision>("required")
        : fetchReviewDecision(api, context, pull.number),
    ),
  );
}

/** The PR rows with the computed `review` column slotted in after the fields. */
async function prRowsWithReview(
  api: GiteaClient,
  context: RepoContext,
  pulls: PullRequest[],
  fields: FieldDef<PullRequest>[],
  now: Date,
): Promise<Record<string, unknown>[]> {
  const decisions = await pullDecisions(api, context, pulls);
  return pulls.map((pull, index) => {
    const row = extractRow(pull, fields, { now, host: context.host, full: false });
    row.review = decisions[index];
    return row;
  });
}

/** Encode a `<noun>` list block, or the raw `emptyLine` when there are no rows. */
function listBlock(noun: string, rows: Record<string, unknown>[], emptyLine: string): string {
  return rows.length > 0 ? encode({ [noun]: rows }) : emptyLine;
}

function shortHelp(context: RepoContext): string[] {
  return [
    suggestCommand(context, "issue list", "to list all open issues"),
    suggestCommand(context, "pr list", "to list all open pull requests"),
    suggestCommand(
      context,
      "--full",
      "for the full dashboard: the open-PR table and issue counts by label",
    ),
  ];
}

function fullHelp(context: RepoContext): string[] {
  return [
    suggestCommand(context, "issue list", "to list all open issues"),
    suggestCommand(context, "pr list", "to list all open pull requests"),
  ];
}

/**
 * The short tier: up to 3 open PRs (with the computed `review`) and up to 3 open
 * issues, fetched in parallel, above a help block that always hints at `--full`.
 */
async function shortDashboard(api: GiteaClient, context: RepoContext): Promise<string> {
  const [openPulls, issues] = await Promise.all([
    fetchOpenPulls(api, context, SHORT_LIMIT),
    fetchOpenIssues(api, context, SHORT_LIMIT),
  ]);

  const now = new Date();
  const prRows = await prRowsWithReview(api, context, openPulls.pulls, SHORT_PR_FIELDS, now);
  const issueRows = issues.map((issue) =>
    extractRow(issue, SHORT_ISSUE_FIELDS, { now, host: context.host, full: false }),
  );

  return [
    `repo: ${context.owner}/${context.name}`,
    listBlock("prs", prRows, "prs: 0 open"),
    listBlock("issues", issueRows, "issues: 0 open"),
    encode({ help: shortHelp(context) }),
  ].join("\n");
}

/**
 * Open issue counts grouped by label: each issue contributes to every label it
 * carries, unlabeled issues fall into a single `unlabeled` bucket rendered only
 * when non-zero, and — when the 1000-issue pagination cap was hit — every count
 * is suffixed with `+` to mark it a lower bound. Labels are ordered by count
 * (descending), ties broken by name, with `unlabeled` always last.
 */
function issueLabelCounts(issues: Issue[], capped: boolean): Record<string, string | number> {
  const counts = new Map<string, number>();
  let unlabeled = 0;
  for (const issue of issues) {
    const names = (issue.labels ?? [])
      .map((label) => label.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    if (names.length === 0) {
      unlabeled += 1;
      continue;
    }
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const mark = (count: number): string | number => (capped ? `${count}+` : count);
  const record: Record<string, string | number> = {};
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [name, count] of ordered) {
    record[name] = mark(count);
  }
  if (unlabeled > 0) {
    record.unlabeled = mark(unlabeled);
  }
  return record;
}

/**
 * The full tier: the open-PR table (up to 20 rows, with labels and the computed
 * `review`) above open issue counts grouped by label, aggregated across every
 * page of open issues up to the 1000-issue cap.
 */
async function fullDashboard(api: GiteaClient, context: RepoContext): Promise<string> {
  const [openPulls, issuePages] = await Promise.all([
    fetchOpenPulls(api, context, FULL_PR_LIMIT),
    fetchAllOpenIssues(api, context),
  ]);

  const now = new Date();
  const prRows = await prRowsWithReview(api, context, openPulls.pulls, FULL_PR_FIELDS, now);
  const labelCounts = issueLabelCounts(issuePages.items, issuePages.capped);

  const issuesBlock =
    Object.keys(labelCounts).length > 0 ? encode({ issues: labelCounts }) : "issues: 0 open";

  return [
    `repo: ${context.owner}/${context.name}`,
    formatCountLine(prRows.length, openPulls.total, prRows.length >= FULL_PR_LIMIT),
    listBlock("prs", prRows, "prs: 0 open"),
    issuesBlock,
    encode({ help: fullHelp(context) }),
  ].join("\n");
}

/**
 * The two-tier home view (ADR 0012). Returns a string so the SDK prepends the
 * `bin:`/`description:` header verbatim; `full` selects the rich tier. Fetching
 * begins with {@link resolveRepoContext}, so outside a Gitea repo this errors
 * with `REPO_NOT_FOUND` before any request goes out.
 */
export function dashboardCommand(deps: CliDeps, full: boolean) {
  return async (): Promise<string> => {
    const context = await resolveRepoContext(deps);
    const api = createClient(context);
    return full ? fullDashboard(api, context) : shortDashboard(api, context);
  };
}
