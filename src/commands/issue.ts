import type { Comment, CreateIssueOption, EditIssueOption, Issue, IssueMeta } from "gitea-js";
import { assigneeLogins, mergeAssignees } from "../assignees.js";
import { BODY_TRUNCATE_LIMIT, truncateBody } from "../body.js";
import { requireBodySource, resolveBodySource } from "../body-source.js";
import { createClient, type GiteaClient } from "../client.js";
import { COMMENT_FLAGS, commentItem, commentRows } from "../comment.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError, httpStatus } from "../errors.js";
import {
  extractRow,
  joined,
  lowercased,
  pluck,
  relativeTimeField,
  selectExtraFields,
  truncatedBody,
  type FieldDef,
} from "../fields.js";
import {
  flagValue,
  parseEnumFlag,
  parseFlags,
  parseIssueNumber,
  parsePositionalNumber,
  parsePositiveInt,
  splitFlag,
} from "../flags.js";
import { resolveLabelIds, resolveMilestoneId } from "../lookup.js";
import { fetchAllPages, readTotalCount } from "../paginate.js";
import { formatCountLine, renderDetail, renderList, type DetailBlock } from "../render.js";
import { suggestCommand } from "../suggestions.js";

export const ISSUE_HELP = `usage: gitea-axi issue <command> [flags]

commands:
  list       List issues in the current repository
  view       Show a single issue's details
  create     Create an issue
  edit       Edit an issue's title, body, labels, assignees, or milestone
  close      Close an issue
  reopen     Reopen a closed issue
  delete     Permanently delete an issue
  pin        Pin an issue to the repository
  unpin      Unpin an issue
  comment    Post a comment on an issue or pull request
  blocks     Manage the issues this issue blocks (Gitea-specific)
  blocked-by Manage the issues that block this issue (Gitea-specific)

Run \`gitea-axi issue <command> --help\` for the flags of a command.
`;

export const ISSUE_BLOCKS_HELP = `usage: gitea-axi issue blocks <list|add|remove> <number> [target]

Manage the issues that an issue blocks — downstream dependents that cannot
proceed until it is resolved (Gitea-specific; no gh-axi equivalent).

commands:
  list <n>              List the issues blocked by issue <n>
  add <n> <target>      Make issue <n> block issue <target>
  remove <n> <target>   Remove the blocking relationship

Adding a relationship that already exists is a no-op that reports \`already: true\`;
removing one that does not exist succeeds silently. Self-reference and cycle
rejections from Gitea surface as VALIDATION_ERROR.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_BLOCKED_BY_HELP = `usage: gitea-axi issue blocked-by <list|add|remove> <number> [blocker]

Manage the issues that block an issue — upstream blockers that must be resolved
before it can proceed (Gitea-specific; no gh-axi equivalent).

commands:
  list <n>              List the issues that block issue <n>
  add <n> <blocker>     Make issue <n> depend on issue <blocker>
  remove <n> <blocker>  Remove the dependency

Adding a relationship that already exists is a no-op that reports \`already: true\`;
removing one that does not exist succeeds silently. Self-reference and cycle
rejections from Gitea surface as VALIDATION_ERROR.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_EDIT_HELP = `usage: gitea-axi issue edit <number> [flags]

Edit an issue in the current repository. At least one change is required.

flags:
  --title <text>              New title
  --body <text>               New body
  --body-file <path>          Read the new body from a file (mutually exclusive with --body)
  --add-label <name>          Add a label by name (repeatable)
  --remove-label <name>       Remove a label by name (repeatable, case-insensitive)
  --add-assignee <login>      Add an assignee (repeatable)
  --remove-assignee <login>   Remove an assignee (repeatable)
  --milestone <name>          Assign a milestone by name (case-insensitive)
  --help                      Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_CLOSE_HELP = `usage: gitea-axi issue close <number> [flags]

Close an issue in the current repository.

flags:
  --comment <text>      Post a comment when closing
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_REOPEN_HELP = `usage: gitea-axi issue reopen <number>

Reopen a closed issue in the current repository.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_DELETE_HELP = `usage: gitea-axi issue delete <number>

Permanently delete an issue in the current repository. This is a hard delete and
requires admin or owner permissions. Deleting a nonexistent issue is an error,
not a silent success.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_PIN_HELP = `usage: gitea-axi issue pin <number>

Pin an issue to the top of the repository's issue list. Pinning an
already-pinned issue is a no-op.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const ISSUE_UNPIN_HELP = `usage: gitea-axi issue unpin <number>

Unpin an issue from the repository's issue list. Unpinning an issue that is not
pinned is a no-op.

flags:
  --help                Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
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
  --full                Show the body field raw, without 500-char truncation
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
  --full                          Show the body field raw, without 500-char truncation
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
  body: truncatedBody("body"),
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
  return parsePositiveInt(value, "--limit", ISSUE_LIST_HELP_SUGGESTION);
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
      "--full": { takesValue: false },
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
  const full = flags["--full"] === true;
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
    extractRow(issue, [...ISSUE_LIST_FIELDS, ...extraFields], { now, host: context.host, full }),
  );
  return renderList({
    noun: "issues",
    rows,
    countLine: formatCountLine(rows.length, total, rows.length >= limit, countStateQualifier(state)),
    help: issueListSuggestions(context, state, rows.length, total),
  });
}

// The count line names the state the list was filtered to, so the answer to
// "how many are open?" is on the summary line rather than only inferable from
// each row. `all` imposes no narrowing and has no natural one-word name, so it
// adds no qualifier and the generic count line stands.
function countStateQualifier(state: IssueState): string | undefined {
  return state === "all" ? undefined : state;
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
  const row = extractRow(issue, ISSUE_VIEW_FIELDS, {
    now: options.now,
    host: options.host,
    full: options.full,
  });
  const body = issue.body ?? "";
  row.body = options.full ? body : truncateBody(body, BODY_TRUNCATE_LIMIT, options.host);
  if (!options.withComments) {
    const count = issue.comments ?? 0;
    row.comment_count = count > 0 ? `${count} — use --comments to see full comments` : 0;
  }
  return row;
}

/** Fetch a single issue, mapping any HTTP failure to an AxiError. */
async function getIssue(api: GiteaClient, context: RepoContext, number: number): Promise<Issue> {
  try {
    const response = await api.repos.issueGetIssue(context.owner, context.name, number);
    return response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }
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
  const issue = await getIssue(api, context, number);

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
    blocks.push({ noun: "comments", rows: commentRows(comments, { host: context.host, full, now }) });
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
  body: truncatedBody("body"),
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
      "--full": { takesValue: false },
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
  const full = flags["--full"] === true;
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

  const item = extractRow(issue, [...ISSUE_CREATE_FIELDS, ...extraFields], {
    now: new Date(),
    host: context.host,
    full,
  });
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

/**
 * The assignee list to PATCH: the issue's current assignees with the requested
 * additions applied and removals dropped (fetch-then-patch, ADR 0007). The
 * current logins are read off a fresh GET, then merged by the shared
 * {@link mergeAssignees}.
 */
async function resolveAssignees(
  api: GiteaClient,
  context: RepoContext,
  number: number,
  add: string[],
  remove: string[],
): Promise<string[]> {
  const issue = await getIssue(api, context, number);
  return mergeAssignees(assigneeLogins(issue.assignees), add, remove);
}

async function issueEdit(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_EDIT_HELP;
  }
  const { flags, lists, positionals } = parseFlags(
    args,
    {
      "--title": { takesValue: true },
      "--body": { takesValue: true },
      "--body-file": { takesValue: true },
      "--add-label": { takesValue: true, repeatable: true },
      "--remove-label": { takesValue: true, repeatable: true },
      "--add-assignee": { takesValue: true, repeatable: true },
      "--remove-assignee": { takesValue: true, repeatable: true },
      "--milestone": { takesValue: true },
    },
    "issue edit",
  );
  const number = parsePositionalNumber(positionals, "issue edit", "issue");
  const title = flagValue(flags, "--title");
  const body = resolveBodySource(deps, flags, "issue edit");
  const milestoneName = flagValue(flags, "--milestone");
  const addLabels = lists["--add-label"] ?? [];
  const removeLabels = lists["--remove-label"] ?? [];
  const addAssignees = lists["--add-assignee"] ?? [];
  const removeAssignees = lists["--remove-assignee"] ?? [];

  const changesAssignees = addAssignees.length > 0 || removeAssignees.length > 0;
  const nothingToDo =
    title === undefined &&
    body === undefined &&
    milestoneName === undefined &&
    addLabels.length === 0 &&
    removeLabels.length === 0 &&
    !changesAssignees;
  if (nothingToDo) {
    throw axiError("issue edit requires at least one change", "VALIDATION_ERROR", [
      "Run `gitea-axi issue edit --help` to see the fields you can change",
    ]);
  }

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Name resolution runs before any mutation: whether a milestone or label name
  // is real does not depend on the issue's state, so a typo is reported before a
  // single change lands, never leaving the issue half-edited.
  const milestoneId =
    milestoneName !== undefined ? await resolveMilestoneId(api, context, milestoneName) : undefined;
  const removeLabelIds = await resolveLabelIds(api, context, removeLabels);

  // Title, body, milestone, and the recomputed assignee list travel in one PATCH.
  const payload: EditIssueOption = {};
  if (title !== undefined) {
    payload.title = title;
  }
  if (body !== undefined) {
    payload.body = body;
  }
  if (milestoneId !== undefined) {
    payload.milestone = milestoneId;
  }
  if (changesAssignees) {
    payload.assignees = await resolveAssignees(api, context, number, addAssignees, removeAssignees);
  }
  if (Object.keys(payload).length > 0) {
    try {
      await api.repos.issueEditIssue(context.owner, context.name, number, payload);
    } catch (error) {
      throw classifyHttpError(error);
    }
  }

  // Label mutations use Gitea's dedicated endpoints (idempotent). `--add-label`
  // passes names straight through — Gitea accepts them there, no lookup needed.
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
      // The label exists in the repo but is not applied to this issue: Gitea
      // answers 404, and the caller's intent (label absent) already holds, so it
      // is silent success rather than an error.
      if (httpStatus(error) === 404) {
        continue;
      }
      throw classifyHttpError(error);
    }
  }

  // The mutation ran, so the block is named for the action, not the entity — a
  // deliberate departure from gh-axi's `issue:` block (see ADR/spec).
  return renderDetail({
    noun: "edited",
    item: { number, status: "ok" },
    help: [suggestCommand(context, `issue view ${number}`, "to see the issue in full")],
  });
}

async function issueClose(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_CLOSE_HELP;
  }
  const { flags, positionals } = parseFlags(
    args,
    { "--comment": { takesValue: true } },
    "issue close",
  );
  const number = parsePositionalNumber(positionals, "issue close", "issue");
  const comment = flagValue(flags, "--comment");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current state first: an already-closed issue short-circuits to the
  // idempotent no-op below rather than issuing a redundant PATCH.
  const issue = await getIssue(api, context, number);
  if (issue.state === "closed") {
    return renderDetail({
      noun: "issue",
      item: { number, state: "closed", message: "Already closed" },
      help: [suggestCommand(context, `issue reopen ${number}`, "to reopen this issue")],
    });
  }

  try {
    await api.repos.issueEditIssue(context.owner, context.name, number, { state: "closed" });
  } catch (error) {
    throw classifyHttpError(error);
  }

  // The comment is a second call after the close lands. A failure here is
  // surfaced, never swallowed: the issue is closed, but the caller must learn
  // that the comment they asked for did not post.
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
    help: [suggestCommand(context, `issue reopen ${number}`, "to reopen this issue")],
  });
}

async function issueReopen(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_REOPEN_HELP;
  }
  const { positionals } = parseFlags(args, {}, "issue reopen");
  const number = parsePositionalNumber(positionals, "issue reopen", "issue");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current state first: an already-open issue short-circuits to the
  // idempotent no-op below rather than issuing a redundant PATCH.
  const issue = await getIssue(api, context, number);
  if (issue.state === "open") {
    return renderDetail({
      noun: "issue",
      item: { number, state: "open", message: "Already open" },
      help: [suggestCommand(context, `issue close ${number}`, "to close this issue")],
    });
  }

  try {
    await api.repos.issueEditIssue(context.owner, context.name, number, { state: "open" });
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "reopened",
    item: { number, status: "ok" },
    help: [suggestCommand(context, `issue view ${number}`, "to see the issue in full")],
  });
}

/**
 * Whether an issue is pinned. Gitea records pin position in `pin_order`, a
 * positive integer for a pinned issue and 0 (or absent) for an unpinned one, so
 * there is no boolean flag to read — the position is the state.
 */
function isPinned(issue: Issue): boolean {
  return (issue.pin_order ?? 0) > 0;
}

async function issueDelete(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_DELETE_HELP;
  }
  const { positionals } = parseFlags(args, {}, "issue delete");
  const number = parsePositionalNumber(positionals, "issue delete", "issue");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // A hard delete, deliberately not idempotent (ADR 0010): a nonexistent issue
  // is a 404, which classify404 maps to ISSUE_NOT_FOUND rather than reporting a
  // deletion that never happened.
  try {
    await api.repos.issueDelete(context.owner, context.name, number);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "issue",
    item: { number, status: "deleted" },
    help: [suggestCommand(context, "issue list", "to see the remaining issues")],
  });
}

async function issuePin(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_PIN_HELP;
  }
  const { positionals } = parseFlags(args, {}, "issue pin");
  const number = parsePositionalNumber(positionals, "issue pin", "issue");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current pin state first: an already-pinned issue short-circuits to
  // the idempotent no-op below rather than issuing a redundant POST.
  const issue = await getIssue(api, context, number);
  const state = issue.state ?? "open";
  if (isPinned(issue)) {
    return renderDetail({
      noun: "issue",
      item: { number, state, pinned: true, message: "Already pinned" },
      help: [suggestCommand(context, `issue unpin ${number}`, "to unpin this issue")],
    });
  }

  try {
    await api.repos.pinIssue(context.owner, context.name, number);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "issue",
    item: { number, state, pinned: true },
    help: [suggestCommand(context, `issue unpin ${number}`, "to unpin this issue")],
  });
}

async function issueUnpin(deps: CliDeps, args: string[]): Promise<string> {
  if (args.includes("--help")) {
    return ISSUE_UNPIN_HELP;
  }
  const { positionals } = parseFlags(args, {}, "issue unpin");
  const number = parsePositionalNumber(positionals, "issue unpin", "issue");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Read the current pin state first: an issue that is not pinned short-circuits
  // to the idempotent no-op below rather than issuing a redundant DELETE.
  const issue = await getIssue(api, context, number);
  const state = issue.state ?? "open";
  if (!isPinned(issue)) {
    return renderDetail({
      noun: "issue",
      item: { number, state, pinned: false, message: "Already unpinned" },
      help: [suggestCommand(context, `issue pin ${number}`, "to pin this issue")],
    });
  }

  try {
    await api.repos.unpinIssue(context.owner, context.name, number);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: "issue",
    item: { number, state, pinned: false },
    help: [suggestCommand(context, `issue pin ${number}`, "to pin this issue")],
  });
}

/**
 * A response page from a relationship-listing endpoint, in the shape
 * {@link fetchAllPages} consumes. Both `/blocks` and `/dependencies` return
 * `Issue[]` with the standard pagination headers.
 */
interface RelationshipPage {
  data?: Issue[];
  headers: Headers;
}

/**
 * One of the two Gitea-specific dependency directions. `blocks` and `blocked-by`
 * are the same three operations (`list`/`add`/`remove`) over two different
 * endpoints, so a single implementation is parameterised by this config: the
 * endpoint calls, the output block/field names the spec fixes, and the noun the
 * second positional carries in errors and help.
 */
interface DependencyGroup {
  /** Subcommand as typed: "blocks" | "blocked-by". */
  command: string;
  /** What the second positional identifies: "target" | "blocker". */
  targetNoun: string;
  /** Output block name for `list`. */
  listNoun: string;
  /** Output entity name for `add`/`remove`. */
  mutationNoun: string;
  /** Key naming the related issue in `add`/`remove` output. */
  targetKey: string;
  /** Help text for the group. */
  help: string;
  listPage: (
    api: GiteaClient,
    context: RepoContext,
    index: number,
    page: number,
    limit: number,
  ) => Promise<RelationshipPage>;
  add: (
    api: GiteaClient,
    context: RepoContext,
    index: number,
    meta: IssueMeta,
  ) => Promise<unknown>;
  remove: (
    api: GiteaClient,
    context: RepoContext,
    index: number,
    meta: IssueMeta,
  ) => Promise<unknown>;
}

// The identifying essentials of a related issue — enough to recognise it without
// the noise of a full issue listing.
const RELATIONSHIP_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
];

const BLOCKS_GROUP: DependencyGroup = {
  command: "blocks",
  targetNoun: "target",
  listNoun: "blocked_issues",
  mutationNoun: "blocks",
  targetKey: "blocks",
  help: ISSUE_BLOCKS_HELP,
  listPage: (api, context, index, page, limit) =>
    api.repos.issueListBlocks(context.owner, context.name, String(index), { page, limit }),
  add: (api, context, index, meta) =>
    api.repos.issueCreateIssueBlocking(context.owner, context.name, String(index), meta),
  remove: (api, context, index, meta) =>
    api.repos.issueRemoveIssueBlocking(context.owner, context.name, String(index), meta),
};

const BLOCKED_BY_GROUP: DependencyGroup = {
  command: "blocked-by",
  targetNoun: "blocker",
  listNoun: "blocking_issues",
  mutationNoun: "blocked_by",
  targetKey: "blocked_by",
  help: ISSUE_BLOCKED_BY_HELP,
  listPage: (api, context, index, page, limit) =>
    api.repos.issueListIssueDependencies(context.owner, context.name, String(index), {
      page,
      limit,
    }),
  add: (api, context, index, meta) =>
    api.repos.issueCreateIssueDependencies(context.owner, context.name, String(index), meta),
  remove: (api, context, index, meta) =>
    api.repos.issueRemoveIssueDependencies(context.owner, context.name, String(index), meta),
};

/**
 * Parse the `<number> <target>` positionals shared by `add` and `remove`. Both
 * arguments are required issue numbers; a missing or extra one is a
 * VALIDATION_ERROR naming what is expected.
 */
function parseIssueAndTarget(
  positionals: string[],
  command: string,
  targetNoun: string,
): { issue: number; target: number } {
  const helpSuggestion = [`Run \`gitea-axi ${command} --help\` to see available flags`];
  if (positionals.length === 0) {
    throw axiError(`${command} requires an issue number`, "VALIDATION_ERROR", [
      `Run \`gitea-axi ${command} <number> <${targetNoun}>\``,
    ]);
  }
  if (positionals.length === 1) {
    throw axiError(`${command} requires a ${targetNoun} issue number`, "VALIDATION_ERROR", [
      `Run \`gitea-axi ${command} <number> <${targetNoun}>\``,
    ]);
  }
  if (positionals.length > 2) {
    throw axiError(`Unexpected argument: ${positionals[2]}`, "VALIDATION_ERROR", helpSuggestion);
  }
  return {
    issue: parseIssueNumber(positionals[0]!, "issue", helpSuggestion),
    target: parseIssueNumber(positionals[1]!, targetNoun, helpSuggestion),
  };
}

/**
 * Every related issue currently on this side of the relationship. Fully
 * paginated so the fetch-first idempotency check (add) and the
 * remove-if-present check (remove) see the complete set, and so `list`'s count
 * describes the whole set rather than a first page (see ADR 0005).
 */
async function fetchRelationships(
  api: GiteaClient,
  context: RepoContext,
  group: DependencyGroup,
  index: number,
): Promise<Issue[]> {
  try {
    const result = await fetchAllPages<Issue>((page, limit) =>
      group.listPage(api, context, index, page, limit),
    );
    return result.items;
  } catch (error) {
    throw classifyHttpError(error);
  }
}

async function listRelationships(
  deps: CliDeps,
  args: string[],
  group: DependencyGroup,
): Promise<string> {
  const command = `issue ${group.command} list`;
  const { positionals } = parseFlags(args, {}, command);
  const number = parsePositionalNumber(positionals, command, "issue");

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  const issues = await fetchRelationships(api, context, group, number);

  const now = new Date();
  const rows = issues.map((issue) =>
    extractRow(issue, RELATIONSHIP_FIELDS, { now, host: context.host, full: false }),
  );
  return renderList({
    noun: group.listNoun,
    rows,
    // The whole set is in hand, so its own size is the total and nothing is
    // withheld by a limit.
    countLine: formatCountLine(rows.length, rows.length, false),
    help: [
      suggestCommand(
        context,
        `issue ${group.command} add ${number} <${group.targetNoun}>`,
        `to add a ${group.command} relationship`,
      ),
    ],
  });
}

async function addRelationship(
  deps: CliDeps,
  args: string[],
  group: DependencyGroup,
): Promise<string> {
  const command = `issue ${group.command} add`;
  const { positionals } = parseFlags(args, {}, command);
  const { issue, target } = parseIssueAndTarget(positionals, command, group.targetNoun);

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Fetch-first idempotency check: an existing relationship is reported as a
  // no-op rather than re-POSTed. A nonexistent issue surfaces here as its own
  // ISSUE_NOT_FOUND, before any mutation is attempted.
  const existing = await fetchRelationships(api, context, group, issue);
  const help = [
    suggestCommand(context, `issue ${group.command} list ${issue}`, "to see the current relationships"),
  ];
  if (existing.some((related) => related.number === target)) {
    return renderDetail({
      noun: group.mutationNoun,
      item: { issue, [group.targetKey]: target, already: true },
      help,
    });
  }

  // The body names the OTHER issue; the issue in the path is `issue`. Self-
  // reference and cycle rejections come back from Gitea as 422, which
  // classifyHttpError maps to VALIDATION_ERROR with the server's own message.
  const meta: IssueMeta = { owner: context.owner, repo: context.name, index: target };
  try {
    await group.add(api, context, issue, meta);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: group.mutationNoun,
    item: { issue, [group.targetKey]: target },
    help,
  });
}

async function removeRelationship(
  deps: CliDeps,
  args: string[],
  group: DependencyGroup,
): Promise<string> {
  const command = `issue ${group.command} remove`;
  const { positionals } = parseFlags(args, {}, command);
  const { issue, target } = parseIssueAndTarget(positionals, command, group.targetNoun);

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // Fetch-first: a relationship that is not present is an idempotent no-op —
  // the caller's intent (relationship absent) already holds, so no DELETE is
  // sent and the output marks it `already: true` (per the action/entity-block
  // convention: a no-op reports the already-reached state rather than claiming
  // an action it did not perform, mirroring `add`). A nonexistent issue still
  // surfaces here as ISSUE_NOT_FOUND.
  const existing = await fetchRelationships(api, context, group, issue);
  const help = [
    suggestCommand(context, `issue ${group.command} list ${issue}`, "to see the current relationships"),
  ];
  if (!existing.some((related) => related.number === target)) {
    return renderDetail({
      noun: group.mutationNoun,
      item: { issue, [group.targetKey]: target, already: true },
      help,
    });
  }

  const meta: IssueMeta = { owner: context.owner, repo: context.name, index: target };
  try {
    await group.remove(api, context, issue, meta);
  } catch (error) {
    throw classifyHttpError(error);
  }

  return renderDetail({
    noun: group.mutationNoun,
    item: { issue, [group.targetKey]: target, removed: true },
    help,
  });
}

/** Dispatch the `list`/`add`/`remove` sub-operation of a dependency group. */
async function issueDependencyGroup(
  deps: CliDeps,
  args: string[],
  group: DependencyGroup,
): Promise<string> {
  const [operation, ...rest] = args;
  if (!operation || operation === "--help") {
    return group.help;
  }
  if (operation === "list") {
    return listRelationships(deps, rest, group);
  }
  if (operation === "add") {
    return addRelationship(deps, rest, group);
  }
  if (operation === "remove") {
    return removeRelationship(deps, rest, group);
  }
  throw axiError(`Unknown issue ${group.command} command: ${operation}`, "VALIDATION_ERROR", [
    `Run \`gitea-axi issue ${group.command} --help\` to see available operations`,
  ]);
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
    if (subcommand === "edit") {
      return issueEdit(deps, rest);
    }
    if (subcommand === "close") {
      return issueClose(deps, rest);
    }
    if (subcommand === "reopen") {
      return issueReopen(deps, rest);
    }
    if (subcommand === "delete") {
      return issueDelete(deps, rest);
    }
    if (subcommand === "pin") {
      return issuePin(deps, rest);
    }
    if (subcommand === "unpin") {
      return issueUnpin(deps, rest);
    }
    if (subcommand === "comment") {
      return issueComment(deps, rest);
    }
    if (subcommand === "blocks") {
      return issueDependencyGroup(deps, rest, BLOCKS_GROUP);
    }
    if (subcommand === "blocked-by") {
      return issueDependencyGroup(deps, rest, BLOCKED_BY_GROUP);
    }
    throw axiError(`Unknown issue command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi issue --help` to see available issue commands",
    ]);
  };
}
