import type { Comment, CreateIssueOption, Issue } from "gitea-js";
import { BODY_TRUNCATE_LIMIT, COMMENT_TRUNCATE_LIMIT, truncateBody } from "../body.js";
import { requireBodySource, resolveBodySource } from "../body-source.js";
import { createClient } from "../client.js";
import { COMMENT_FLAGS, commentItem } from "../comment.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError } from "../errors.js";
import {
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
  splitFlag,
} from "../flags.js";
import { resolveLabelIds, resolveMilestoneId } from "../lookup.js";
import { fetchAllPages, readTotalCount } from "../paginate.js";
import { formatCountLine, renderDetail, renderList, type DetailBlock } from "../render.js";
import { relativeTime } from "../time.js";
import { suggestCommand } from "../suggestions.js";

export const ISSUE_HELP = `usage: gitea-axi issue <command> [flags]

commands:
  list       List issues in the current repository
  view       Show a single issue's details
  create     Create an issue
  comment    Post a comment on an issue or pull request

Run \`gitea-axi issue <command> --help\` for the flags of a command.
`;

export const ISSUE_CREATE_HELP = `usage: gitea-axi issue create --title <text> [flags]

Create an issue in the current repository.

flags:
  --title <text>        Issue title (required)
  --body <text>         Issue body
  --body-file <path>    Read the issue body from a file (mutually exclusive with --body)
  --assignee <login>    Assign the issue to a user
  --label <name>        Apply a label by name (repeatable, case-insensitive)
  --milestone <name>    Assign a milestone by name (case-insensitive)
  --fields <a,b,c>      Append extra fields: labels, assignees, milestone, body
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_COMMENT_HELP = `usage: gitea-axi issue comment <number> [flags]

Post a comment on an issue. Pull request numbers are accepted — issues and pull
requests share the comment endpoint.

flags:
  --body <text>         Comment body (required unless --body-file is given)
  --body-file <path>    Read the comment body from a file (mutually exclusive with --body)
  --full                Echo the posted body in full, without truncating it at 800 chars
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_VIEW_HELP = `usage: gitea-axi issue view <number> [flags]

Show a single issue. Pull request numbers are rejected — use \`pr view\` instead.

flags:
  --comments   Render every comment in full (bodies truncated at 800 chars)
  --full       Suppress all truncation of the issue body and comment bodies
  --help       Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_LIST_HELP = `usage: gitea-axi issue list [flags]

List issues in the current repository. Pull requests are never included.

flags:
  --state <open|closed|all>       Filter by state (default: open)
  --label <a,b>                   Filter by label name (comma-separated)
  --assignee <login>              Filter by assignee
  --author <login>                Filter by author
  --milestone <name>              Filter by milestone name
  --sort <created|updated|comments>  Sort descending (client-side)
  --limit <n>                     Maximum number of issues to return (default: 30)
  --fields <a,b,c>                Append extra fields: body, closedAt, labels, milestone, updatedAt, url
  --help                          Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

const ISSUE_LIST_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
  relativeTimeField("created", "created_at"),
];

// Appended to the defaults on request via `--fields`, never replacing them.
const ISSUE_LIST_EXTRA_FIELDS: Record<string, FieldDef<Issue>> = {
  body: pluck("body"),
  closedAt: relativeTimeField("closedAt", "closed_at"),
  labels: joined("labels", "labels", "name"),
  milestone: pluck("milestone", "milestone.title"),
  updatedAt: relativeTimeField("updatedAt", "updated_at"),
  url: pluck("url", "html_url"),
};

const ISSUE_STATES = ["open", "closed", "all"] as const;
type IssueState = (typeof ISSUE_STATES)[number];

const ISSUE_SORTS = ["created", "updated", "comments"] as const;
type IssueSort = (typeof ISSUE_SORTS)[number];

/** Sort keys, read descending. A missing or unparseable value sorts last. */
const ISSUE_SORT_KEYS: Record<IssueSort, (issue: Issue) => number> = {
  created: (issue) => timestamp(issue.created_at),
  updated: (issue) => timestamp(issue.updated_at),
  comments: (issue) => issue.comments ?? 0,
};

const DEFAULT_LIMIT = 30;

const ISSUE_LIST_HELP_SUGGESTION = [
  "Run `gitea-axi issue list --help` to see available flags",
];

function timestamp(iso: string | undefined): number {
  const value = Date.parse(iso ?? "");
  return Number.isNaN(value) ? 0 : value;
}

function parseState(value: string | true | undefined): IssueState {
  return parseEnumFlag(value, "--state", ISSUE_STATES, ISSUE_LIST_HELP_SUGGESTION) ?? "open";
}

function parseSort(value: string | true | undefined): IssueSort | undefined {
  return parseEnumFlag(value, "--sort", ISSUE_SORTS, ISSUE_LIST_HELP_SUGGESTION);
}

/**
 * Gitea's issue list has no sort parameter, so ordering happens here, over the
 * fully paginated set (see ADR 0005). `sort` is stable, so equal keys keep the
 * order the API returned them in.
 */
function sortIssues(issues: Issue[], sort: IssueSort): Issue[] {
  const key = ISSUE_SORT_KEYS[sort];
  return [...issues].sort((a, b) => key(b) - key(a));
}

/**
 * The filters Gitea's issue list accepts as query params, under its own names.
 * All four filter server-side; none of them needs the client-side policy.
 */
function issueListFilters(flags: Record<string, string | true>): Record<string, string> {
  const filters: Record<string, string> = {};
  const label = flagValue(flags, "--label");
  if (label !== undefined) {
    filters.labels = label;
  }
  const assignee = flagValue(flags, "--assignee");
  if (assignee !== undefined) {
    filters.assigned_by = assignee;
  }
  const author = flagValue(flags, "--author");
  if (author !== undefined) {
    filters.created_by = author;
  }
  const milestone = flagValue(flags, "--milestone");
  if (milestone !== undefined) {
    filters.milestones = milestone;
  }
  return filters;
}

/**
 * `--search` is refused rather than quietly forwarded to the API's `q` param:
 * full-text search is `search issues`, and a flag that half-worked here would be
 * the wrong thing to learn. Checked ahead of `parseFlags` so every form of the
 * flag — valued, inline, bare — lands on the redirect instead of a generic
 * unknown-flag or missing-value error.
 */
function refuseSearchFlag(args: string[]): void {
  if (!args.some((arg) => splitFlag(arg).name === "--search")) {
    return;
  }
  throw axiError("issue list does not support --search", "VALIDATION_ERROR", [
    'Use `gitea-axi search issues "<query>"` for full-text search',
  ]);
}

function parseLimit(value: string | true | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = Number(value);
  if (value === true || !Number.isInteger(limit) || limit < 1) {
    throw axiError(
      `Invalid --limit value: ${String(value)} (expected a positive integer)`,
      "VALIDATION_ERROR",
      ISSUE_LIST_HELP_SUGGESTION,
    );
  }
  return limit;
}

function issueListSuggestions(
  context: RepoContext,
  state: IssueState,
  shown: number,
  total: number | undefined,
): string[] {
  const help: string[] = [];
  if (state !== "all") {
    help.push(suggestCommand(context, "issue list --state all", "to list issues in any state"));
  }
  if (total !== undefined && shown < total) {
    help.push(
      suggestCommand(context, "issue list --limit <n>", `to fetch more of the ${total} issues`),
    );
  }
  if (help.length === 0) {
    help.push(
      suggestCommand(context, "issue list --help", "to see all issue list flags"),
    );
  }
  return help;
}

async function issueList(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_LIST_HELP;
  }
  refuseSearchFlag(args);
  const { flags, positionals } = parseFlags(
    args,
    {
      "--state": { takesValue: true },
      "--label": { takesValue: true },
      "--assignee": { takesValue: true },
      "--author": { takesValue: true },
      "--milestone": { takesValue: true },
      "--sort": { takesValue: true },
      "--limit": { takesValue: true },
      "--fields": { takesValue: true },
    },
    "issue list",
  );
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      ISSUE_LIST_HELP_SUGGESTION,
    );
  }
  const state = parseState(flags["--state"]);
  const sort = parseSort(flags["--sort"]);
  const limit = parseLimit(flags["--limit"]);
  const extraFields = selectExtraFields(
    flagValue(flags, "--fields"),
    ISSUE_LIST_EXTRA_FIELDS,
    "issue list",
  );
  const query = { state, type: "issues" as const, ...issueListFilters(flags) };

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let issues: Issue[];
  let total: number | undefined;
  try {
    if (sort === undefined) {
      const response = await api.repos.issueListIssues(context.owner, context.name, {
        ...query,
        limit,
        page: 1,
      });
      issues = response.data ?? [];
      total = readTotalCount(response.headers);
    } else {
      // Sorting client-side means holding the whole set first: the top `limit`
      // by the sort key is only knowable once every page is in (see ADR 0005).
      const result = await fetchAllPages<Issue>((page, pageLimit) =>
        api.repos.issueListIssues(context.owner, context.name, {
          ...query,
          page,
          limit: pageLimit,
        }),
      );
      issues = sortIssues(result.items, sort).slice(0, limit);
      // Sorting reorders without changing membership, so the API's own total
      // still describes this result set and the count line keeps reporting it.
      // Having paginated everything, the set's own size is the fallback when an
      // instance omits the header — a total is always reported (Principle 4).
      total = result.total ?? result.items.length;
    }
  } catch (error) {
    throw classifyHttpError(error);
  }

  const now = new Date();
  const rows = issues.map((issue) =>
    extractRow(issue, [...ISSUE_LIST_FIELDS, ...extraFields], { now }),
  );
  return renderList({
    noun: "issues",
    rows,
    countLine: formatCountLine(rows.length, total, rows.length >= limit),
    help: issueListSuggestions(context, state, rows.length, total),
  });
}

// The default detail fields reuse the same declarative extraction as the list
// path; only `body` (truncation) and `comment_count` need bespoke handling.
const ISSUE_VIEW_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
  relativeTimeField("created", "created_at"),
];

interface IssueDetailOptions {
  host: string;
  full: boolean;
  withComments: boolean;
  now: Date;
}

function buildIssueDetail(issue: Issue, options: IssueDetailOptions): Record<string, unknown> {
  const row = extractRow(issue, ISSUE_VIEW_FIELDS, { now: options.now });
  const body = issue.body ?? "";
  row.body = options.full ? body : truncateBody(body, BODY_TRUNCATE_LIMIT, options.host);
  if (!options.withComments) {
    const count = issue.comments ?? 0;
    row.comment_count = count > 0 ? `${count} — use --comments to see full comments` : 0;
  }
  return row;
}

function buildCommentRows(
  comments: Comment[],
  options: { host: string; full: boolean; now: Date },
): Record<string, unknown>[] {
  return comments.map((comment) => {
    const body = comment.body ?? "";
    return {
      author: comment.user?.login ?? "",
      created: relativeTime(comment.created_at, options.now),
      body: options.full ? body : truncateBody(body, COMMENT_TRUNCATE_LIMIT, options.host),
    };
  });
}

function issueViewSuggestions(
  context: RepoContext,
  number: number,
  options: { withComments: boolean; commentCount: number; bodyAbbreviated: boolean },
): string[] {
  const help: string[] = [];
  if (!options.withComments && options.commentCount > 0) {
    help.push(suggestCommand(context, `issue view ${number} --comments`, "to see full comments"));
  }
  if (options.bodyAbbreviated) {
    help.push(suggestCommand(context, `issue view ${number} --full`, "to see the complete body"));
  }
  if (help.length === 0) {
    help.push(suggestCommand(context, `issue view ${number} --help`, "to see all issue view flags"));
  }
  return help;
}

async function issueView(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_VIEW_HELP;
  }
  const { flags, positionals } = parseFlags(
    args,
    { "--comments": { takesValue: false }, "--full": { takesValue: false } },
    "issue view",
  );
  const number = parsePositionalNumber(positionals, "issue view", "issue");
  const full = flags["--full"] === true;
  const withComments = flags["--comments"] === true;

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let issue: Issue;
  try {
    const response = await api.repos.issueGetIssue(context.owner, context.name, number);
    issue = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  if (issue.pull_request) {
    throw axiError(`issue #${number} is a pull request`, "VALIDATION_ERROR", [
      suggestCommand(context, `pr view ${number}`, "to view this pull request"),
    ]);
  }

  const now = new Date();
  const item = buildIssueDetail(issue, { host: context.host, full, withComments, now });

  const blocks: DetailBlock[] = [];
  if (withComments) {
    let comments: Comment[];
    try {
      const response = await api.repos.issueGetComments(context.owner, context.name, number);
      comments = response.data ?? [];
    } catch (error) {
      throw classifyHttpError(error);
    }
    blocks.push({ noun: "comments", rows: buildCommentRows(comments, { host: context.host, full, now }) });
  }

  const commentCount = issue.comments ?? 0;
  // Suggest --full whenever the rendered body differs from the raw one — cleaned
  // or truncated alike — read straight off the rendered output so the two never
  // drift from truncateBody's own limit decision.
  const bodyAbbreviated = item.body !== (issue.body ?? "");
  return renderDetail({
    noun: "issue",
    item,
    blocks,
    help: issueViewSuggestions(context, number, { withComments, commentCount, bodyAbbreviated }),
  });
}

const ISSUE_CREATE_HELP_SUGGESTION = [
  "Run `gitea-axi issue create --help` to see available flags",
];

// Default create output, per the spec: number, title, state, url (= html_url).
const ISSUE_CREATE_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("url", "html_url"),
];

// Appended to the defaults on request via `--fields`, never replacing them.
const ISSUE_CREATE_EXTRA_FIELDS: Record<string, FieldDef<Issue>> = {
  labels: joined("labels", "labels", "name"),
  assignees: joined("assignees", "assignees", "login"),
  milestone: pluck("milestone", "milestone.title"),
  body: pluck("body"),
};

async function issueCreate(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_CREATE_HELP;
  }
  const { flags, lists, positionals } = parseFlags(
    args,
    {
      "--title": { takesValue: true },
      "--body": { takesValue: true },
      "--body-file": { takesValue: true },
      "--assignee": { takesValue: true },
      "--label": { takesValue: true, repeatable: true },
      "--milestone": { takesValue: true },
      "--fields": { takesValue: true },
    },
    "issue create",
  );
  if (positionals.length > 0) {
    throw axiError(
      `Unexpected argument: ${positionals[0]}`,
      "VALIDATION_ERROR",
      ISSUE_CREATE_HELP_SUGGESTION,
    );
  }

  // Everything that can fail on the caller's own input is settled before any
  // request goes out, so a rejected invocation never half-creates an issue.
  const title = flagValue(flags, "--title");
  if (title === undefined) {
    throw axiError("issue create requires --title <text>", "VALIDATION_ERROR", [
      "Run `gitea-axi issue create --title <text>`",
    ]);
  }
  const body = resolveBodySource(deps, flags, "issue create");
  const extraFields = selectExtraFields(
    flagValue(flags, "--fields"),
    ISSUE_CREATE_EXTRA_FIELDS,
    "issue create",
  );
  const assignee = flagValue(flags, "--assignee");
  const milestoneName = flagValue(flags, "--milestone");
  const labelNames = lists["--label"] ?? [];

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  const payload: CreateIssueOption = { title };
  if (body !== undefined) {
    payload.body = body;
  }
  if (assignee !== undefined) {
    payload.assignees = [assignee];
  }
  const labelIds = await resolveLabelIds(api, context, labelNames);
  if (labelIds.length > 0) {
    payload.labels = labelIds;
  }
  if (milestoneName !== undefined) {
    payload.milestone = await resolveMilestoneId(api, context, milestoneName);
  }

  let issue: Issue;
  try {
    const response = await api.repos.issueCreateIssue(context.owner, context.name, payload);
    issue = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  const item = extractRow(issue, [...ISSUE_CREATE_FIELDS, ...extraFields], { now: new Date() });
  return renderDetail({
    noun: "issue",
    item,
    help: [
      suggestCommand(context, `issue view ${issue.number}`, "to see the issue in full"),
    ],
  });
}

async function issueComment(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_COMMENT_HELP;
  }
  const { flags, positionals } = parseFlags(args, COMMENT_FLAGS, "issue comment");
  const number = parsePositionalNumber(positionals, "issue comment", "issue");
  const body = requireBodySource(deps, flags, "issue comment");
  const full = flags["--full"] === true;

  // No type guard here: issues and pull requests genuinely share this endpoint,
  // so a PR number is a valid target and is never fetched to be checked.
  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let comment: Comment;
  try {
    const response = await api.repos.issueCreateComment(context.owner, context.name, number, {
      body,
    });
    comment = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }

  const item = commentItem(comment, { number, full, host: context.host, now: new Date() });

  // Gitea marks a comment posted on a pull request with `pull_request_url`. Only
  // an issue target gets the `issue view` suggestion: `issue view` type-guards
  // pull requests, so suggesting it after commenting on one would hand back a
  // command that is guaranteed to fail.
  const help = comment.pull_request_url
    ? [suggestCommand(context, "issue comment --help", "to see all issue comment flags")]
    : [suggestCommand(context, `issue view ${number} --comments`, "to see the full thread")];
  return renderDetail({ noun: "comment", item, help });
}

export function issueCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return ISSUE_HELP;
    }
    if (subcommand === "list") {
      return issueList(deps, rest);
    }
    if (subcommand === "view") {
      return issueView(deps, rest);
    }
    if (subcommand === "create") {
      return issueCreate(deps, rest);
    }
    if (subcommand === "comment") {
      return issueComment(deps, rest);
    }
    throw axiError(`Unknown issue command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi issue --help` to see available issue commands",
    ]);
  };
}
