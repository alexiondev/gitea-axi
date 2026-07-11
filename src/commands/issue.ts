import type { Issue } from "gitea-js";
import { createClient } from "../client.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError } from "../errors.js";
import { extractRow, lowercased, pluck, relativeTimeField, type FieldDef } from "../fields.js";
import { parseFlags } from "../flags.js";
import { formatCountLine, renderList } from "../render.js";
import { suggestCommand } from "../suggestions.js";

export const ISSUE_HELP = `usage: gitea-axi issue <command> [flags]

commands:
  list    List issues in the current repository

Run \`gitea-axi issue list --help\` for the flags of a command.
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

export function issueCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return ISSUE_HELP;
    }
    if (subcommand === "list") {
      return issueList(deps, rest);
    }
    throw axiError(`Unknown issue command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi issue --help` to see available issue commands",
    ]);
  };
}
