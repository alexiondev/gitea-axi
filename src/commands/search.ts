import type { Issue } from "gitea-js";
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
import { flagValue, parseEnumFlag, parseFlags, parsePositiveInt } from "../flags.js";
import { fetchAllPages } from "../paginate.js";
import { formatCountLine, renderList } from "../render.js";
import { suggestCommand } from "../suggestions.js";

export const SEARCH_HELP = `usage: gitea-axi search <issues|prs> <query> [flags]

Full-text search within the current repository. The positional query is
required.

commands:
  issues     Search issues in the current repository
  prs        Search pull requests in the current repository

Run \`gitea-axi search <command> --help\` for the flags of a command.
`;

export const SEARCH_ISSUES_HELP = `usage: gitea-axi search issues <query> [flags]

Full-text search for issues in the current repository. Results are found across
the repositories the owner can access and filtered to the current one, so the
count reflects the current repository's matches. Use the number with
\`issue view\` to load a match in full.

flags:
  --state <open|closed|all>       Filter by state (default: open)
  --label <a,b>                   Filter by label name (comma-separated)
  --limit <n>                     Maximum number of matches to return (default: 30)
  --fields <a,b,c>                Append extra fields: body, closedAt, labels, milestone, updatedAt, url
  --help                          Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

export const SEARCH_PRS_HELP = `usage: gitea-axi search prs <query> [flags]

Full-text search for pull requests in the current repository. Results are found
across the repositories the owner can access and filtered to the current one, so
the count reflects the current repository's matches. Use the number with
\`pr view\` to load a match in full.

flags:
  --state <open|closed|all>       Filter by state (default: open)
  --label <a,b>                   Filter by label name (comma-separated)
  --limit <n>                     Maximum number of matches to return (default: 30)
  --fields <a,b,c>                Append extra fields: body, closedAt, labels, milestone, updatedAt, url
  --help                          Show this help

global flags:
  -R, --repo <OWNER/NAME>     Override the repository detected from the git origin remote
  --login <name>              Select a tea login profile by name
`;

// The locator schema (spec): enough to recognise a match and feed its number
// into `issue view` / `pr view`, which load the full detail. `draft`/`review`
// parity with the list commands would cost extra fetches per result for a
// command whose job is only to find the number.
const SEARCH_FIELDS: FieldDef<Issue>[] = [
  pluck("number"),
  pluck("title"),
  lowercased("state"),
  pluck("author", "user.login"),
  relativeTimeField("created", "created_at"),
];

// Appended to the locator schema on request via `--fields`, never replacing it.
// Results are Issue-shaped, so this mirrors `issue list`'s extra-field vocabulary.
const SEARCH_EXTRA_FIELDS: Record<string, FieldDef<Issue>> = {
  body: pluck("body"),
  closedAt: relativeTimeField("closedAt", "closed_at"),
  labels: joined("labels", "labels", "name"),
  milestone: pluck("milestone", "milestone.title"),
  updatedAt: relativeTimeField("updatedAt", "updated_at"),
  url: pluck("url", "html_url"),
};

/**
 * The two search variants. `search issues` and `search prs` are the same
 * endpoint call, repo filter, and render, differing only in the `type` param,
 * the output block noun, and the `view` command a match feeds into.
 */
interface SearchKind {
  /** Subcommand as typed, for help and error text. */
  command: string;
  /** Gitea search `type` param: issues or pull requests. */
  type: "issues" | "pulls";
  /** Output block noun, matching the list commands. */
  noun: string;
  /** The command a matched number feeds into. */
  viewCommand: string;
  /** The `--help` text for this variant. */
  help: string;
}

const SEARCH_ISSUES: SearchKind = {
  command: "search issues",
  type: "issues",
  noun: "issues",
  viewCommand: "issue view",
  help: SEARCH_ISSUES_HELP,
};

const SEARCH_PRS: SearchKind = {
  command: "search prs",
  type: "pulls",
  noun: "pull_requests",
  viewCommand: "pr view",
  help: SEARCH_PRS_HELP,
};

const SEARCH_STATES = ["open", "closed", "all"] as const;
type SearchState = (typeof SEARCH_STATES)[number];

const DEFAULT_LIMIT = 30;

/**
 * Whether a search result belongs to the current repository. The search
 * endpoint spans every repo the owner has, so results are filtered here via
 * each result's `repository` field (owner and name matched case-insensitively,
 * as Gitea treats them).
 */
function inCurrentRepo(issue: Issue, context: RepoContext): boolean {
  const repo = issue.repository;
  return (
    repo?.owner?.toLowerCase() === context.owner.toLowerCase() &&
    repo?.name?.toLowerCase() === context.name.toLowerCase()
  );
}

async function runSearch(deps: CliDeps, args: string[], kind: SearchKind): Promise<string> {
  if (args.includes("--help")) {
    return kind.help;
  }
  const helpSuggestion = [`Run \`gitea-axi ${kind.command} --help\` to see available flags`];
  const { flags, positionals } = parseFlags(
    args,
    {
      "--state": { takesValue: true },
      "--label": { takesValue: true },
      "--limit": { takesValue: true },
      "--fields": { takesValue: true },
    },
    kind.command,
  );
  if (positionals.length === 0) {
    throw axiError(`${kind.command} requires a query`, "VALIDATION_ERROR", [
      `Run \`gitea-axi ${kind.command} "<query>"\``,
    ]);
  }
  if (positionals.length > 1) {
    throw axiError(`Unexpected argument: ${positionals[1]}`, "VALIDATION_ERROR", helpSuggestion);
  }
  const query = positionals[0]!;
  const state: SearchState =
    parseEnumFlag(flags["--state"], "--state", SEARCH_STATES, helpSuggestion) ?? "open";
  // The search endpoint's `labels` param takes comma-separated names directly, so
  // `--label` passes straight through — no name→id lookup, unlike `pr list`.
  const labels = flagValue(flags, "--label");
  const limitFlag = flags["--limit"];
  const limit =
    limitFlag === undefined ? DEFAULT_LIMIT : parsePositiveInt(limitFlag, "--limit", helpSuggestion);
  const extraFields = selectExtraFields(
    flagValue(flags, "--fields"),
    SEARCH_EXTRA_FIELDS,
    kind.command,
  );

  const context = await resolveRepoContext(deps);
  const api = createClient(context);

  // The repo filter has no API param, so the whole result set is paged in and
  // filtered here; the filtered set's own size is the count-line total, since
  // the endpoint's total spans every repo (ADR 0005 client-side policy).
  let matches: Issue[];
  try {
    const result = await fetchAllPages<Issue>((page, pageLimit) =>
      api.repos.issueSearchIssues({
        q: query,
        type: kind.type,
        owner: context.owner,
        state,
        ...(labels !== undefined ? { labels } : {}),
        page,
        limit: pageLimit,
      }),
    );
    matches = result.items.filter((issue) => inCurrentRepo(issue, context));
  } catch (error) {
    throw classifyHttpError(error);
  }

  const total = matches.length;
  const shown = matches.slice(0, limit);
  const now = new Date();
  const rows = shown.map((issue) => extractRow(issue, [...SEARCH_FIELDS, ...extraFields], { now }));

  return renderList({
    noun: kind.noun,
    rows,
    countLine: formatCountLine(rows.length, total, false),
    help: [suggestCommand(context, `${kind.viewCommand} <number>`, "to see a match in full")],
  });
}

export function searchCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return SEARCH_HELP;
    }
    if (subcommand === "issues") {
      return runSearch(deps, rest, SEARCH_ISSUES);
    }
    if (subcommand === "prs") {
      return runSearch(deps, rest, SEARCH_PRS);
    }
    throw axiError(`Unknown search command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi search --help` to see available search commands",
    ]);
  };
}
