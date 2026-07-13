import type {
  Comment,
  CreatePullRequestOption,
  EditPullRequestOption,
  PullRequest,
  PullReview,
  PullReviewComment,
  PullReviewRequestOptions,
  Repository,
} from "gitea-js";
import { assigneeLogins, mergeAssignees } from "../assignees.js";
import { BODY_TRUNCATE_LIMIT, COMMENT_TRUNCATE_LIMIT, truncateBody } from "../body.js";
import { requireBodySource, resolveBodySource } from "../body-source.js";
import { createClient, type GiteaClient } from "../client.js";
import { COMMENT_FLAGS, commentItem, commentRows } from "../comment.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError, httpStatus } from "../errors.js";
import {
  boolText,
  extractRow,
  joined,
  lowercased,
  pluck,
  relativeTimeField,
  selectExtraFields,
  type FieldDef,
} from "../fields.js";
import {
  flagValue,
  parseEnumFlag,
  parseFlags,
  parsePositionalNumber,
  parsePositiveInt,
  splitFlag,
} from "../flags.js";
import { fetchChecks } from "../checks.js";
import { currentBranch } from "../git.js";
import { resolveLabelIds, resolveMilestoneId } from "../lookup.js";
import { fetchAllPages, readTotalCount } from "../paginate.js";
import { formatCountLine, renderDetail, renderList, renderScalar, type DetailBlock } from "../render.js";
import { fetchReviewComments, fetchReviewDecision, fetchReviews } from "../review.js";
import { suggestCommand } from "../suggestions.js";
import { relativeTime } from "../time.js";

export const PR_HELP = `usage: gitea-axi pr <command> [flags]

commands:
  list       List pull requests in the current repository
  view       Show a single pull request's details
  checks     Show a pull request's CI check results
  create     Create a pull request
  edit       Edit a pull request's title, body, labels, assignees, reviewers, milestone, or base
  close      Close a pull request
  reopen     Reopen a closed pull request
  comment    Post a comment on a pull request

Run \`gitea-axi pr <command> --help\` for the flags of a command.
`;

export const PR_EDIT_HELP = `usage: gitea-axi pr edit <number> [flags]

Edit a pull request in the current repository. At least one change is required.

flags:
  --title <text>              New title
  --body <text>               New body
  --body-file <path>          Read the new body from a file (mutually exclusive with --body)
  --base <branch>             Change the base branch to merge into
  --add-label <name>          Add a label by name (repeatable)
  --remove-label <name>       Remove a label by name (repeatable, case-insensitive)
  --add-assignee <login>      Add an assignee (repeatable)
  --remove-assignee <login>   Remove an assignee (repeatable)
  --add-reviewer <login>      Request a review from a user (repeatable)
  --remove-reviewer <login>   Cancel a requested review (repeatable)
  --milestone <name>          Assign a milestone by name (case-insensitive)
  --help                      Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_CLOSE_HELP = `usage: gitea-axi pr close <number> [flags]

Close a pull request in the current repository. Closing an already-closed or
merged pull request is a no-op.

flags:
  --comment <text>      Post a comment when closing
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_REOPEN_HELP = `usage: gitea-axi pr reopen <number>

Reopen a closed pull request in the current repository. Reopening an
already-open pull request is a no-op.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_VIEW_HELP = `usage: gitea-axi pr view <number> [flags]

Show a single pull request, including its CI checks and review summary.

flags:
  --comments   Render every comment in full (bodies truncated at 800 chars)
  --reviews    Render every review with its inline comments (Gitea official/stale fields)
  --full       Suppress all truncation of the PR body and comment bodies
  --help       Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_CHECKS_HELP = `usage: gitea-axi pr checks <number>

Show the CI check results for a pull request, derived from its head commit's
combined status.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_LIST_HELP = `usage: gitea-axi pr list [flags]

List pull requests in the current repository.

flags:
  --state <open|closed|all>       Filter by state (default: open)
  --label <name>                  Filter by label name (comma-separated, case-insensitive)
  --label-id <id>                 Filter by label ID, bypassing the name lookup
  --assignee <login>              Filter by assignee (client-side)
  --author <login>                Filter by author
  --base <branch>                 Filter by base branch (client-side)
  --head <branch>                 Filter by head branch (client-side)
  --draft                         Show only draft pull requests (client-side)
  --sort <oldest|recentupdate|leastupdate|mostcomment|leastcomment|priority>
                                  Sort order (passed to the API)
  --limit <n>                     Maximum number of pull requests to return (default: 30)
  --fields <a,b,c>                Append extra fields: body, createdAt, labels, milestone, mergedAt, url
  --help                          Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_CREATE_HELP = `usage: gitea-axi pr create --title <text> [flags]

Create a pull request in the current repository. An open pull request already
existing for the same base and head branches is reported instead of duplicated.

flags:
  --title <text>        Pull request title (required)
  --body <text>         Pull request body
  --body-file <path>    Read the body from a file (mutually exclusive with --body)
  --base <branch>       Branch to merge into (default: the repository's default branch)
  --head <branch>       Branch to merge from (default: the current local branch)
  --assignee <login>    Assign the pull request to a user
  --reviewer <login>    Request a review from a user
  --label <name>        Apply a label by name (repeatable, case-insensitive)
  --milestone <name>    Assign a milestone by name (case-insensitive)
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const PR_COMMENT_HELP = `usage: gitea-axi pr comment <number> [flags]

Post a comment on a pull request.

flags:
  --body <text>         Comment body (required unless --body-file is given)
  --body-file <path>    Read the comment body from a file (mutually exclusive with --body)
  --full                Echo the posted body in full, without truncating it at 800 chars
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

const PR_CREATE_HELP_SUGGESTION = [
  "Run `gitea-axi pr create --help` to see available flags",
];

const PR_LIST_HELP_SUGGESTION = [
  "Run `gitea-axi pr list --help` to see available flags",
];

// The `review` column is not one of these: it comes from a separate reviews
// fetch per PR (ADR 0006), so it is set on each row after the decision resolves,
// slotting in after `draft` and before any `--fields` extras.
const PR_LIST_FIELDS: FieldDef<PullRequest>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
  boolText("draft"),
];

// Appended to the defaults on request via `--fields`, never replacing them.
const PR_LIST_EXTRA_FIELDS: Record<string, FieldDef<PullRequest>> = {
  body: pluck("body"),
  createdAt: relativeTimeField("created", "created_at"),
  labels: joined("labels", "labels", "name"),
  milestone: pluck("milestone", "milestone.title"),
  mergedAt: relativeTimeField("merged_at", "merged_at"),
  url: pluck("url", "html_url"),
};

// The default `pr view` fields that reuse the shared declarative extraction;
// `merged`, `checks`, `body`, `comment_count`, and `review_count` are handled
// bespokely in buildPrDetail, since each needs a computed or fetched value.
const PR_VIEW_FIELDS: FieldDef<PullRequest>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
  boolText("draft"),
];

const PR_STATES = ["open", "closed", "all"] as const;
type PrState = (typeof PR_STATES)[number];

const PR_SORTS = [
  "oldest",
  "recentupdate",
  "leastupdate",
  "mostcomment",
  "leastcomment",
  "priority",
] as const;
type PrSort = (typeof PR_SORTS)[number];

const PR_DEFAULT_LIMIT = 30;

/**
 * The client-side filters — those Gitea's PR list has no query param for
 * (ADR 0005). When any is set the whole result set is paginated and filtered
 * in-process, and the count line's total is the filtered set's own size.
 */
interface ClientFilters {
  assignee: string | undefined;
  base: string | undefined;
  head: string | undefined;
  draftOnly: boolean;
}

function readClientFilters(flags: Record<string, string | true>): ClientFilters {
  return {
    assignee: flagValue(flags, "--assignee"),
    base: flagValue(flags, "--base"),
    head: flagValue(flags, "--head"),
    draftOnly: flags["--draft"] === true,
  };
}

function hasClientFilter(filters: ClientFilters): boolean {
  return (
    filters.assignee !== undefined ||
    filters.base !== undefined ||
    filters.head !== undefined ||
    filters.draftOnly
  );
}

function matchesClientFilters(pull: PullRequest, filters: ClientFilters): boolean {
  if (filters.draftOnly && pull.draft !== true) {
    return false;
  }
  // Branch names are case-sensitive in git, so base and head match exactly.
  if (filters.base !== undefined && pull.base?.ref !== filters.base) {
    return false;
  }
  if (filters.head !== undefined && pull.head?.ref !== filters.head) {
    return false;
  }
  if (filters.assignee !== undefined) {
    const target = filters.assignee.toLowerCase();
    const assigned = (pull.assignees ?? []).some(
      (user) => user.login?.toLowerCase() === target,
    );
    if (!assigned) {
      return false;
    }
  }
  return true;
}

function parsePrState(value: string | true | undefined): PrState {
  return parseEnumFlag(value, "--state", PR_STATES, PR_LIST_HELP_SUGGESTION) ?? "open";
}

function parsePrSort(value: string | true | undefined): PrSort | undefined {
  return parseEnumFlag(value, "--sort", PR_SORTS, PR_LIST_HELP_SUGGESTION);
}

function parsePrLimit(value: string | true | undefined): number {
  if (value === undefined) {
    return PR_DEFAULT_LIMIT;
  }
  return parsePositiveInt(value, "--limit", PR_LIST_HELP_SUGGESTION);
}

/**
 * The label ids to send as the API `labels` filter. `--label-id` is passed
 * through as an integer; `--label` is resolved name→id case-insensitively, since
 * the PR list endpoint takes ids, not names. Both may be given at once.
 */
async function resolvePrLabelIds(
  api: GiteaClient,
  context: RepoContext,
  flags: Record<string, string | true>,
): Promise<number[]> {
  const ids: number[] = [];
  const labelId = flagValue(flags, "--label-id");
  if (labelId !== undefined) {
    for (const raw of labelId.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }
      ids.push(parsePositiveInt(trimmed, "--label-id", PR_LIST_HELP_SUGGESTION));
    }
  }
  const label = flagValue(flags, "--label");
  if (label !== undefined) {
    const names = label
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    ids.push(...(await resolveLabelIds(api, context, names)));
  }
  return ids;
}

/**
 * `--search` is refused rather than quietly forwarded to the API's `q` param:
 * full-text search is `search prs`. Checked ahead of `parseFlags` so every form
 * of the flag — valued, inline, bare — lands on the redirect (mirrors the same
 * guard on `issue list`).
 */
function refusePrSearchFlag(args: string[]): void {
  if (!args.some((arg) => splitFlag(arg).name === "--search")) {
    return;
  }
  throw axiError("pr list does not support --search", "VALIDATION_ERROR", [
    'Use `gitea-axi search prs "<query>"` for full-text search',
  ]);
}

function prListSuggestions(
  context: RepoContext,
  state: PrState,
  shown: number,
  total: number | undefined,
): string[] {
  if (shown === 0) {
    const help = [
      suggestCommand(context, "pr create --title <text>", "to create a pull request"),
    ];
    if (state !== "closed" && state !== "all") {
      help.push(
        suggestCommand(context, "pr list --state closed", "to see closed pull requests"),
      );
    }
    return help;
  }
  const help = [suggestCommand(context, "pr view <number>", "to see a pull request in full")];
  if (total !== undefined && shown < total) {
    help.push(
      suggestCommand(context, "pr list --limit <n>", `to fetch more of the ${total} pull requests`),
    );
  }
  return help;
}

async function prList(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_LIST_HELP;
  }
  refusePrSearchFlag(args);
  const { flags, positionals } = parseFlags(
    args,
    {
      "--state": { takesValue: true },
      "--label": { takesValue: true },
      "--label-id": { takesValue: true },
      "--assignee": { takesValue: true },
      "--author": { takesValue: true },
      "--base": { takesValue: true },
      "--head": { takesValue: true },
      "--draft": { takesValue: false },
      "--sort": { takesValue: true },
      "--limit": { takesValue: true },
      "--fields": { takesValue: true },
    },
    "pr list",
  );
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      PR_LIST_HELP_SUGGESTION,
    );
  }
  const state = parsePrState(flags["--state"]);
  const sort = parsePrSort(flags["--sort"]);
  const limit = parsePrLimit(flags["--limit"]);
  const extraFields = selectExtraFields(
    flagValue(flags, "--fields"),
    PR_LIST_EXTRA_FIELDS,
    "pr list",
  );
  const filters = readClientFilters(flags);

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Label names resolve to ids before the list call — the PR list endpoint takes
  // ids, and a typo must be reported the same way whether or not the filter would
  // have matched anything.
  const labelIds = await resolvePrLabelIds(api, context, flags);
  const query = {
    state,
    ...(sort !== undefined ? { sort } : {}),
    ...(flagValue(flags, "--author") !== undefined
      ? { poster: flagValue(flags, "--author") }
      : {}),
    ...(labelIds.length > 0 ? { labels: labelIds } : {}),
  };

  let pulls: PullRequest[];
  let total: number | undefined;
  try {
    if (hasClientFilter(filters)) {
      // A client-side filter has no API param, so the whole set is paged in and
      // filtered here; the filtered set's own size is the count-line total, since
      // X-Total-Count describes the unfiltered result (ADR 0005).
      const result = await fetchAllPages<PullRequest>((page, pageLimit) =>
        api.repos.repoListPullRequests(context.owner, context.name, {
          ...query,
          page,
          limit: pageLimit,
        }),
      );
      const filtered = result.items.filter((pull) => matchesClientFilters(pull, filters));
      total = filtered.length;
      pulls = filtered.slice(0, limit);
    } else {
      const response = await api.repos.repoListPullRequests(context.owner, context.name, {
        ...query,
        limit,
        page: 1,
      });
      pulls = response.data ?? [];
      total = readTotalCount(response.headers);
    }
  } catch (error) {
    throw classifyHttpError(error);
  }

  // One review fetch per rendered PR, all in flight at once (ADR 0006).
  const decisions = await Promise.all(
    pulls.map((pull) => fetchReviewDecision(api, context, pullNumber(pull))),
  );

  const now = new Date();
  const rows = pulls.map((pull, index) => {
    const row = extractRow(pull, PR_LIST_FIELDS, { now });
    row.review = decisions[index];
    Object.assign(row, extractRow(pull, extraFields, { now }));
    return row;
  });

  return renderList({
    noun: "pull_requests",
    rows,
    countLine: formatCountLine(rows.length, total, rows.length >= limit),
    help: prListSuggestions(context, state, rows.length, total),
  });
}

/** The branch to merge from: the caller's `--head`, else the local checkout's. */
async function resolveHead(deps: CliDeps, head: string | undefined): Promise<string> {
  if (head !== undefined) {
    return head;
  }
  const branch = await currentBranch(deps);
  if (branch === null) {
    throw axiError(
      "Could not determine the current branch to use as the head branch",
      "VALIDATION_ERROR",
      ["Pass `--head <branch>` to name the branch to merge from"],
    );
  }
  return branch;
}

/** The branch to merge into: the caller's `--base`, else the repository's default. */
async function resolveBase(
  api: GiteaClient,
  context: RepoContext,
  base: string | undefined,
): Promise<string> {
  if (base !== undefined) {
    return base;
  }
  let repo: Repository;
  try {
    const response = await api.repos.repoGet(context.owner, context.name);
    repo = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }
  if (!repo.default_branch) {
    throw axiError(
      `Repository ${context.owner}/${context.name} reports no default branch`,
      "VALIDATION_ERROR",
      ["Pass `--base <branch>` to name the branch to merge into"],
    );
  }
  return repo.default_branch;
}

/**
 * The open pull request for a base/head pair, or undefined when there is none.
 * Gitea answers its by-base-head lookup with a 404 when no pull request matches
 * the pair at all, which is the ordinary "nothing to short-circuit to" case
 * rather than a failure. The lookup matches on the branches alone, so a closed
 * or merged pull request can come back too — that must not block a fresh one,
 * since its branches are free to be proposed again.
 */
async function findOpenPull(
  api: GiteaClient,
  context: RepoContext,
  base: string,
  head: string,
): Promise<PullRequest | undefined> {
  let pull: PullRequest;
  try {
    const response = await api.repos.repoGetPullRequestByBaseHead(
      context.owner,
      context.name,
      base,
      head,
    );
    pull = response.data;
  } catch (error) {
    if (httpStatus(error) === 404) {
      return undefined;
    }
    throw classifyHttpError(error);
  }
  return pull.state === "open" ? pull : undefined;
}

/**
 * The number Gitea gave a pull request. The generated client types it optional,
 * but every real pull request has one, and a number invented to fill the gap
 * would be reported as fact and interpolated into the next command to run — so a
 * response without one is treated as the broken answer it is.
 */
function pullNumber(pull: PullRequest): number {
  if (pull.number === undefined) {
    throw axiError("Gitea returned a pull request with no number", "UNKNOWN");
  }
  return pull.number;
}

/** Fetch a single pull request, mapping any HTTP failure to an AxiError. */
async function getPull(api: GiteaClient, context: RepoContext, number: number): Promise<PullRequest> {
  try {
    const response = await api.repos.repoGetPullRequest(context.owner, context.name, number);
    return response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * The PR head commit SHA, the ref the combined-status fetch keys on. Every real
 * pull request has one; a response without it is treated as the broken answer it
 * is, rather than inventing a SHA to fetch a status for.
 */
function headSha(pull: PullRequest): string {
  const sha = pull.head?.sha;
  if (!sha) {
    throw axiError("Gitea returned a pull request with no head SHA", "UNKNOWN");
  }
  return sha;
}

interface PrDetailOptions {
  host: string;
  full: boolean;
  withComments: boolean;
  withReviews: boolean;
  checksSummary: string;
  reviewCount: number;
  now: Date;
}

function buildPrDetail(pull: PullRequest, options: PrDetailOptions): Record<string, unknown> {
  const row = extractRow(pull, PR_VIEW_FIELDS, { now: options.now });
  // gh-axi renders `merged` as `no` when open, or the merge time once merged.
  row.merged = pull.merged ? relativeTime(pull.merged_at, options.now) : "no";
  row.checks = options.checksSummary;
  const body = pull.body ?? "";
  row.body = options.full ? body : truncateBody(body, BODY_TRUNCATE_LIMIT, options.host);
  // Each count scalar is replaced by its full block when the matching flag is
  // passed, mirroring `issue view`'s comment_count (ADR: no redundant scalar).
  if (!options.withComments) {
    const count = pull.comments ?? 0;
    row.comment_count = count > 0 ? `${count} — use --comments to see full comments` : 0;
  }
  if (!options.withReviews) {
    row.review_count =
      options.reviewCount > 0
        ? `${options.reviewCount} — use --reviews to see full reviews`
        : 0;
  }
  return row;
}

function prViewSuggestions(
  context: RepoContext,
  number: number,
  options: {
    withComments: boolean;
    commentCount: number;
    withReviews: boolean;
    reviewCount: number;
    bodyAbbreviated: boolean;
  },
): string[] {
  const help: string[] = [];
  if (!options.withComments && options.commentCount > 0) {
    help.push(suggestCommand(context, `pr view ${number} --comments`, "to see full comments"));
  }
  if (!options.withReviews && options.reviewCount > 0) {
    help.push(suggestCommand(context, `pr view ${number} --reviews`, "to see full reviews"));
  }
  if (options.bodyAbbreviated) {
    help.push(suggestCommand(context, `pr view ${number} --full`, "to see the complete body"));
  }
  if (help.length === 0) {
    help.push(suggestCommand(context, `pr view ${number} --help`, "to see all pr view flags"));
  }
  return help;
}

interface ReviewRowsOptions {
  host: string;
  full: boolean;
  now: Date;
}

/**
 * The `reviews` block rows for `--reviews`: each review with its Gitea-specific
 * `official`/`stale` flags and its inline (diff) comments. One comments fetch per
 * review, all in flight at once; review and comment bodies truncate at 800 chars
 * unless `--full` is set.
 */
async function buildReviewRows(
  api: GiteaClient,
  context: RepoContext,
  number: number,
  reviews: PullReview[],
  options: ReviewRowsOptions,
): Promise<Record<string, unknown>[]> {
  const commentLists = await Promise.all(
    reviews.map((review) =>
      review.id !== undefined
        ? fetchReviewComments(api, context, number, review.id)
        : Promise.resolve<PullReviewComment[]>([]),
    ),
  );
  const truncate = (text: string): string =>
    options.full ? text : truncateBody(text, COMMENT_TRUNCATE_LIMIT, options.host);
  return reviews.map((review, index) => ({
    author: review.user?.login ?? "",
    state: (review.state ?? "").toLowerCase(),
    official: review.official ? "yes" : "no",
    stale: review.stale ? "yes" : "no",
    body: truncate(review.body ?? ""),
    comments: commentLists[index]!.map((comment) => ({
      author: comment.user?.login ?? "",
      path: comment.path ?? "",
      body: truncate(comment.body ?? ""),
    })),
  }));
}

async function prView(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_VIEW_HELP;
  }
  const { flags, positionals } = parseFlags(
    args,
    {
      "--comments": { takesValue: false },
      "--reviews": { takesValue: false },
      "--full": { takesValue: false },
    },
    "pr view",
  );
  const number = parsePositionalNumber(positionals, "pr view", "pull request");
  const full = flags["--full"] === true;
  const withComments = flags["--comments"] === true;
  const withReviews = flags["--reviews"] === true;

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // The PR and its reviews are fetched in parallel; the combined status then
  // needs the head SHA, so it follows once the PR is in hand — three calls
  // always, so `checks` and `review_count` are in the default output (ADR 0006).
  const [pull, reviews] = await Promise.all([
    getPull(api, context, number),
    fetchReviews(api, context, number),
  ]);
  const checksResult = await fetchChecks(api, context, headSha(pull));

  const now = new Date();
  const item = buildPrDetail(pull, {
    host: context.host,
    full,
    withComments,
    withReviews,
    checksSummary: checksResult.summary,
    reviewCount: reviews.length,
    now,
  });

  const blocks: DetailBlock[] = [];
  if (withComments) {
    // PRs share the issue-comment endpoint, so their comments come from
    // GET /issues/{n}/comments — the same fetch `issue view --comments` makes.
    let comments: Comment[];
    try {
      const response = await api.repos.issueGetComments(context.owner, context.name, number);
      comments = response.data ?? [];
    } catch (error) {
      throw classifyHttpError(error);
    }
    blocks.push({ noun: "comments", rows: commentRows(comments, { host: context.host, full, now }) });
  }
  if (withReviews) {
    blocks.push({
      noun: "reviews",
      rows: await buildReviewRows(api, context, number, reviews, { host: context.host, full, now }),
    });
  }

  const commentCount = pull.comments ?? 0;
  const bodyAbbreviated = item.body !== (pull.body ?? "");
  return renderDetail({
    noun: "pull_request",
    item,
    blocks,
    help: prViewSuggestions(context, number, {
      withComments,
      commentCount,
      withReviews,
      reviewCount: reviews.length,
      bodyAbbreviated,
    }),
  });
}

async function prChecks(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_CHECKS_HELP;
  }
  const { positionals } = parseFlags(args, {}, "pr checks");
  const number = parsePositionalNumber(positionals, "pr checks", "pull request");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // The combined status is keyed on the head SHA, so the PR is fetched first to
  // learn it (GET /pulls/{n}), then its head commit's combined status.
  const pull = await getPull(api, context, number);
  const result = await fetchChecks(api, context, headSha(pull));

  const help = [suggestCommand(context, `pr view ${number}`, "to see the pull request in full")];
  // No statuses at all is a scalar `checks:` message, not an empty list block —
  // there is nothing to tabulate, so the summary line stands on its own.
  if (result.checks.length === 0) {
    return renderScalar("checks", result.summary, help);
  }
  // Otherwise the summary occupies renderList's lead line, above the per-check rows.
  return renderList({
    noun: "checks",
    rows: result.checks.map((check) => ({ name: check.name, conclusion: check.conclusion })),
    countLine: `summary: ${result.summary}`,
    help,
  });
}

async function prCreate(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_CREATE_HELP;
  }
  const { flags, lists, positionals } = parseFlags(
    args,
    {
      "--title": { takesValue: true },
      "--body": { takesValue: true },
      "--body-file": { takesValue: true },
      "--base": { takesValue: true },
      "--head": { takesValue: true },
      "--assignee": { takesValue: true },
      "--reviewer": { takesValue: true },
      "--label": { takesValue: true, repeatable: true },
      "--milestone": { takesValue: true },
    },
    "pr create",
  );
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      PR_CREATE_HELP_SUGGESTION,
    );
  }

  // Everything that can fail on the caller's own input — including the head
  // branch, which git alone can answer — is settled before any request goes out,
  // so a rejected invocation never half-creates a pull request.
  const title = flagValue(flags, "--title");
  if (title === undefined) {
    throw axiError("pr create requires --title <text>", "VALIDATION_ERROR", [
      "Run `gitea-axi pr create --title <text>`",
    ]);
  }
  const body = resolveBodySource(deps, flags, "pr create");
  const assignee = flagValue(flags, "--assignee");
  const reviewer = flagValue(flags, "--reviewer");
  const milestoneName = flagValue(flags, "--milestone");
  const labelNames = lists["--label"] ?? [];
  const head = await resolveHead(deps, flagValue(flags, "--head"));

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  const base = await resolveBase(api, context, flagValue(flags, "--base"));

  // Names are resolved before the existence check, not after: whether a label
  // name is real does not depend on remote state, so a typo must be reported the
  // same way whether or not the pull request happens to exist already.
  const labelIds = await resolveLabelIds(api, context, labelNames);
  const milestoneId =
    milestoneName !== undefined
      ? await resolveMilestoneId(api, context, milestoneName)
      : undefined;

  const existing = await findOpenPull(api, context, base, head);
  if (existing) {
    const number = pullNumber(existing);
    return renderDetail({
      noun: "pull_request",
      item: { number, url: existing.html_url ?? "", already: true },
      help: [
        suggestCommand(
          context,
          `pr comment ${number} --body <text>`,
          "to comment on the existing pull request",
        ),
      ],
    });
  }

  const payload: CreatePullRequestOption = { title, base, head };
  if (body !== undefined) {
    payload.body = body;
  }
  if (assignee !== undefined) {
    payload.assignees = [assignee];
  }
  if (reviewer !== undefined) {
    payload.reviewers = [reviewer];
  }
  if (labelIds.length > 0) {
    payload.labels = labelIds;
  }
  if (milestoneId !== undefined) {
    payload.milestone = milestoneId;
  }

  let pull: PullRequest;
  try {
    const response = await api.repos.repoCreatePullRequest(context.owner, context.name, payload);
    pull = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  // The mutation ran, so the block is named for the action; the no-op path above
  // reports the entity instead.
  const number = pullNumber(pull);
  return renderDetail({
    noun: "created",
    item: { number, url: pull.html_url ?? "" },
    help: [
      suggestCommand(context, `pr comment ${number} --body <text>`, "to comment on the pull request"),
    ],
  });
}

async function prComment(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_COMMENT_HELP;
  }
  const { flags, positionals } = parseFlags(args, COMMENT_FLAGS, "pr comment");
  const number = parsePositionalNumber(positionals, "pr comment", "pull request");
  const body = requireBodySource(deps, flags, "pr comment");
  const full = flags["--full"] === true;

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let comment: Comment;
  try {
    // Pull requests share the issue comment endpoint, and it answers with the
    // created comment — no follow-up view call is needed to report it (ADR 0008).
    const response = await api.repos.issueCreateComment(context.owner, context.name, number, {
      body,
    });
    comment = response.data;
  } catch (error) {
    // The endpoint's path says `issues`, but the caller asked about a pull
    // request, so a missing target is reported as the pull request it is.
    if (httpStatus(error) === 404) {
      throw axiError(`Pull request #${number} not found`, "PR_NOT_FOUND");
    }
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "comment",
    item: commentItem(comment, { number, full, host: context.host, now: new Date() }),
    help: [suggestCommand(context, "pr comment --help", "to see all pr comment flags")],
  });
}

/**
 * The assignee list to PATCH: the pull request's current assignees with the
 * requested additions applied and removals dropped (fetch-then-patch, ADR 0007).
 * The current logins are read off a fresh GET, then merged by the shared
 * {@link mergeAssignees}.
 */
async function resolvePullAssignees(
  api: GiteaClient,
  context: RepoContext,
  number: number,
  add: string[],
  remove: string[],
): Promise<string[]> {
  const pull = await getPull(api, context, number);
  return mergeAssignees(assigneeLogins(pull.assignees), add, remove);
}

/**
 * The state to report for a pull request in the close no-op: `merged` marks a
 * merged pull request (whose `state` Gitea reports as `closed`), otherwise the
 * raw state stands.
 */
function pullState(pull: PullRequest): string {
  return pull.merged ? "merged" : (pull.state ?? "closed");
}

async function prEdit(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_EDIT_HELP;
  }
  const { flags, lists, positionals } = parseFlags(
    args,
    {
      "--title": { takesValue: true },
      "--body": { takesValue: true },
      "--body-file": { takesValue: true },
      "--base": { takesValue: true },
      "--add-label": { takesValue: true, repeatable: true },
      "--remove-label": { takesValue: true, repeatable: true },
      "--add-assignee": { takesValue: true, repeatable: true },
      "--remove-assignee": { takesValue: true, repeatable: true },
      "--add-reviewer": { takesValue: true, repeatable: true },
      "--remove-reviewer": { takesValue: true, repeatable: true },
      "--milestone": { takesValue: true },
    },
    "pr edit",
  );
  const number = parsePositionalNumber(positionals, "pr edit", "pull request");
  const title = flagValue(flags, "--title");
  const body = resolveBodySource(deps, flags, "pr edit");
  const base = flagValue(flags, "--base");
  const milestoneName = flagValue(flags, "--milestone");
  const addLabels = lists["--add-label"] ?? [];
  const removeLabels = lists["--remove-label"] ?? [];
  const addAssignees = lists["--add-assignee"] ?? [];
  const removeAssignees = lists["--remove-assignee"] ?? [];
  const addReviewers = lists["--add-reviewer"] ?? [];
  const removeReviewers = lists["--remove-reviewer"] ?? [];

  const changesAssignees = addAssignees.length > 0 || removeAssignees.length > 0;
  const nothingToDo =
    title === undefined &&
    body === undefined &&
    base === undefined &&
    milestoneName === undefined &&
    addLabels.length === 0 &&
    removeLabels.length === 0 &&
    !changesAssignees &&
    addReviewers.length === 0 &&
    removeReviewers.length === 0;
  if (nothingToDo) {
    throw axiError("pr edit requires at least one change", "VALIDATION_ERROR", [
      "Run `gitea-axi pr edit --help` to see the fields you can change",
    ]);
  }

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Name resolution runs before any mutation: whether a milestone or label name
  // is real does not depend on the pull request's state, so a typo is reported
  // before a single change lands, never leaving the pull request half-edited.
  const milestoneId =
    milestoneName !== undefined ? await resolveMilestoneId(api, context, milestoneName) : undefined;
  const removeLabelIds = await resolveLabelIds(api, context, removeLabels);

  // Title, body, base, milestone, and the recomputed assignee list travel in one
  // PATCH — the reviewers are the exception, having no field on this body.
  const payload: EditPullRequestOption = {};
  if (title !== undefined) {
    payload.title = title;
  }
  if (body !== undefined) {
    payload.body = body;
  }
  if (base !== undefined) {
    payload.base = base;
  }
  if (milestoneId !== undefined) {
    payload.milestone = milestoneId;
  }
  if (changesAssignees) {
    payload.assignees = await resolvePullAssignees(
      api,
      context,
      number,
      addAssignees,
      removeAssignees,
    );
  }
  if (Object.keys(payload).length > 0) {
    try {
      await api.repos.repoEditPullRequest(context.owner, context.name, number, payload);
    } catch (error) {
      throw classifyHttpError(error);
    }
  }

  // Label mutations use Gitea's dedicated endpoints (idempotent). `--add-label`
  // passes names straight through — Gitea accepts them there, no lookup needed —
  // while `--remove-label` resolved to ids above (mirrors `issue edit`).
  if (addLabels.length > 0) {
    try {
      await api.repos.issueAddLabel(context.owner, context.name, number, { labels: addLabels });
    } catch (error) {
      throw classifyHttpError(error);
    }
  }
  for (const id of removeLabelIds) {
    try {
      await api.repos.issueRemoveLabel(context.owner, context.name, number, id);
    } catch (error) {
      // The label exists in the repo but is not applied to this pull request:
      // Gitea answers 404, and the caller's intent (label absent) already holds,
      // so it is silent success rather than an error.
      if (httpStatus(error) === 404) {
        continue;
      }
      throw classifyHttpError(error);
    }
  }

  // Reviewer mutations go through Gitea's dedicated requested-reviewers endpoints
  // — `EditPullRequestOption` has no reviewers field, so fetch-then-patch is
  // structurally impossible here (ADR 0007 amendment). Each direction is one call
  // carrying the whole list.
  if (addReviewers.length > 0) {
    const options: PullReviewRequestOptions = { reviewers: addReviewers };
    try {
      await api.repos.repoCreatePullReviewRequests(context.owner, context.name, number, options);
    } catch (error) {
      throw classifyHttpError(error);
    }
  }
  if (removeReviewers.length > 0) {
    const options: PullReviewRequestOptions = { reviewers: removeReviewers };
    try {
      await api.repos.repoDeletePullReviewRequests(context.owner, context.name, number, options);
    } catch (error) {
      throw classifyHttpError(error);
    }
  }

  // The mutation ran, so the block is named for the action, not the entity.
  return renderDetail({
    noun: "edited",
    item: { number, status: "ok" },
    help: [suggestCommand(context, `pr view ${number}`, "to see the pull request in full")],
  });
}

async function prClose(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_CLOSE_HELP;
  }
  const { flags, positionals } = parseFlags(args, { "--comment": { takesValue: true } }, "pr close");
  const number = parsePositionalNumber(positionals, "pr close", "pull request");
  const comment = flagValue(flags, "--comment");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current state first: an already-closed or merged pull request
  // short-circuits to the idempotent no-op below rather than issuing a redundant
  // PATCH. A merged pull request has state `closed`, so this catches both.
  const pull = await getPull(api, context, number);
  if (pull.state === "closed") {
    return renderDetail({
      noun: "pull_request",
      item: { number, state: pullState(pull), already: true },
      help: [suggestCommand(context, `pr reopen ${number}`, "to reopen this pull request")],
    });
  }

  try {
    await api.repos.repoEditPullRequest(context.owner, context.name, number, { state: "closed" });
  } catch (error) {
    throw classifyHttpError(error);
  }

  // The comment is a second call after the close lands. A failure here is
  // surfaced, never swallowed: the pull request is closed, but the caller must
  // learn that the comment they asked for did not post.
  if (comment !== undefined) {
    try {
      await api.repos.issueCreateComment(context.owner, context.name, number, { body: comment });
    } catch (error) {
      throw classifyHttpError(error);
    }
  }

  return renderDetail({
    noun: "closed",
    item: { number, status: "ok" },
    help: [suggestCommand(context, `pr reopen ${number}`, "to reopen this pull request")],
  });
}

async function prReopen(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return PR_REOPEN_HELP;
  }
  const { positionals } = parseFlags(args, {}, "pr reopen");
  const number = parsePositionalNumber(positionals, "pr reopen", "pull request");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current state first: an already-open pull request short-circuits to
  // the idempotent no-op below rather than issuing a redundant PATCH.
  const pull = await getPull(api, context, number);
  if (pull.state === "open") {
    return renderDetail({
      noun: "pull_request",
      item: { number, state: "open", already: true },
      help: [suggestCommand(context, `pr close ${number}`, "to close this pull request")],
    });
  }

  try {
    await api.repos.repoEditPullRequest(context.owner, context.name, number, { state: "open" });
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "reopened",
    item: { number, status: "ok" },
    help: [suggestCommand(context, `pr view ${number}`, "to see the pull request in full")],
  });
}

export function prCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return PR_HELP;
    }
    if (subcommand === "list") {
      return prList(deps, rest);
    }
    if (subcommand === "view") {
      return prView(deps, rest);
    }
    if (subcommand === "checks") {
      return prChecks(deps, rest);
    }
    if (subcommand === "create") {
      return prCreate(deps, rest);
    }
    if (subcommand === "edit") {
      return prEdit(deps, rest);
    }
    if (subcommand === "close") {
      return prClose(deps, rest);
    }
    if (subcommand === "reopen") {
      return prReopen(deps, rest);
    }
    if (subcommand === "comment") {
      return prComment(deps, rest);
    }
    throw axiError(`Unknown pr command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi pr --help` to see available pr commands",
    ]);
  };
}
