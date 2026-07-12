import type { Comment, CreatePullRequestOption, PullRequest, Repository } from "gitea-js";
import { requireBodySource, resolveBodySource } from "../body-source.js";
import { createClient, type GiteaClient } from "../client.js";
import { COMMENT_FLAGS, commentItem } from "../comment.js";
import { resolveRepoContext, type RepoContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { axiError, classifyHttpError, httpStatus } from "../errors.js";
import { flagValue, parseFlags, parsePositionalNumber } from "../flags.js";
import { currentBranch } from "../git.js";
import { resolveLabelIds, resolveMilestoneId } from "../lookup.js";
import { renderDetail } from "../render.js";
import { suggestCommand } from "../suggestions.js";

export const PR_HELP = `usage: gitea-axi pr <command> [flags]

commands:
  create     Create a pull request
  comment    Post a comment on a pull request

Run \`gitea-axi pr <command> --help\` for the flags of a command.
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

export function prCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand === "--help") {
      return PR_HELP;
    }
    if (subcommand === "create") {
      return prCreate(deps, rest);
    }
    if (subcommand === "comment") {
      return prComment(deps, rest);
    }
    throw axiError(`Unknown pr command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi pr --help` to see available pr commands",
    ]);
  };
}
