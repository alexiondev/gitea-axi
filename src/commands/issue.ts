import type { Comment, CreateIssueOption, Issue } from "gitea-js";
import {
  BODY_TRUNCATE_LIMIT,
  COMMENT_TRUNCATE_LIMIT,
  truncateBody,
} from "../body.js";
import { requireBodySource, resolveBodySource } from "../body-source.js";
import { createClient } from "../client.js";
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
import { flagValue, parseFlags } from "../flags.js";
import { resolveLabelIds, resolveMilestoneId } from "../lookup.js";
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
  --state <open|closed|all>   Filter by state (default: open)
  --limit <n>                 Maximum number of issues to return (default: 30)
  --help                      Show this help

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

const ISSUE_STATES = ["open", "closed", "all"] as const;
type IssueState = (typeof ISSUE_STATES)[number];

const DEFAULT_LIMIT = 30;

const ISSUE_LIST_HELP_SUGGESTION = [
  "Run `gitea-axi issue list --help` to see available flags",
];

function parseState(value: string | true | undefined): IssueState {
  if (value === undefined) {
    return "open";
  }
  if (value === true || !ISSUE_STATES.includes(value as IssueState)) {
    throw axiError(
      `Invalid --state value: ${String(value)} (expected open, closed, or all)`,
      "VALIDATION_ERROR",
      ISSUE_LIST_HELP_SUGGESTION,
    );
  }
  return value as IssueState;
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
  const { flags, positionals } = parseFlags(
    args,
    { "--state": { takesValue: true }, "--limit": { takesValue: true } },
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
  const limit = parseLimit(flags["--limit"]);

  const context = await resolveRepoContext(deps);
  const api = createClient(context);
  let response;
  try {
    response = await api.repos.issueListIssues(context.owner, context.name, {
      state,
      type: "issues",
      limit,
      page: 1,
    });
  } catch (error) {
    throw classifyHttpError(error);
  }
  const issues = response.data ?? [];
  const totalHeader = response.headers.get("x-total-count");
  const total = totalHeader !== null ? Number(totalHeader) : undefined;
  const resolvedTotal = total !== undefined && Number.isFinite(total) ? total : undefined;

  const now = new Date();
  const rows = issues.map((issue) => extractRow(issue, ISSUE_LIST_FIELDS, { now }));
  return renderList({
    noun: "issues",
    rows,
    countLine: formatCountLine(rows.length, resolvedTotal, rows.length >= limit),
    help: issueListSuggestions(context, state, rows.length, resolvedTotal),
  });
}

function parseIssueNumber(positionals: string[], command: string): number {
  const helpSuggestion = [`Run \`gitea-axi ${command} --help\` to see available flags`];
  if (positionals.length === 0) {
    throw axiError(`${command} requires an issue number`, "VALIDATION_ERROR", [
      `Run \`gitea-axi ${command} <number>\``,
    ]);
  }
  if (positionals.length > 1) {
    throw axiError(
      `Unexpected argument: ${positionals[1]}`,
      "VALIDATION_ERROR",
      helpSuggestion,
    );
  }
  const raw = positionals[0]!;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    throw axiError(
      `Invalid issue number: ${raw} (expected a positive integer)`,
      "VALIDATION_ERROR",
      helpSuggestion,
    );
  }
  return number;
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
  const number = parseIssueNumber(positionals, "issue view");
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
  const { flags, positionals } = parseFlags(
    args,
    {
      "--body": { takesValue: true },
      "--body-file": { takesValue: true },
      "--full": { takesValue: false },
    },
    "issue comment",
  );
  const number = parseIssueNumber(positionals, "issue comment");
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

  const raw = comment.body ?? "";
  const item = {
    // The issue the comment was posted to — the comment's own id is not output.
    number,
    author: comment.user?.login ?? "",
    created: relativeTime(comment.created_at, new Date()),
    body: full ? raw : truncateBody(raw, COMMENT_TRUNCATE_LIMIT, context.host),
  };

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
