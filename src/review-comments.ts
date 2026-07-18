import type { CreatePullReviewComment } from "gitea-js";
import type { GiteaClient } from "./client.js";
import type { RepoContext } from "./context.js";
import type { CliDeps } from "./deps.js";
import { anchorFromDiffHunk } from "./diff.js";
import { axiError } from "./errors.js";
import { readFlagFile } from "./flag-file.js";
import { flagValue } from "./flags.js";
import { fetchAllReviewComments } from "./review.js";

/**
 * One entry from a `pr review --comments-file` JSON array, in one of two shapes.
 * There is deliberately no `side` field: a new comment is always the new side,
 * and a reply's side is inferred from the comment it targets.
 */
export type InlineCommentEntry =
  | { reply_to: number; body: string }
  | { path: string; line: number; body: string };

const COMMENTS_FILE_SUGGESTION = [
  "Each entry must be `{ reply_to, body }` or `{ path, line, body }`",
];

/**
 * Read and validate the `--comments-file` batch, if the flag is present. Returns
 * `undefined` when it is absent, so a plain review is unaffected. Every failure —
 * a missing/unreadable file, non-JSON, a non-array, or an entry matching neither
 * shape — is a `VALIDATION_ERROR` raised here, before any request goes out.
 */
export function loadInlineComments(
  deps: CliDeps,
  flags: Record<string, string | true>,
  command: string,
): InlineCommentEntry[] | undefined {
  const path = flagValue(flags, "--comments-file");
  if (path === undefined) {
    return undefined;
  }
  return parseInlineComments(readCommentsFile(deps, path, command), command);
}

function readCommentsFile(deps: CliDeps, path: string, command: string): string {
  return readFlagFile(deps, path, "--comments-file", [
    `Run \`gitea-axi ${command} --comments-file <path>\` with a readable JSON file`,
  ]);
}

function parseInlineComments(text: string, command: string): InlineCommentEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw axiError(`--comments-file is not valid JSON: ${reason}`, "VALIDATION_ERROR");
  }
  if (!Array.isArray(parsed)) {
    throw axiError(
      "--comments-file must be a JSON array of inline-comment entries",
      "VALIDATION_ERROR",
      COMMENTS_FILE_SUGGESTION,
    );
  }
  return parsed.map((entry, index) => validateEntry(entry, index));
}

function validateEntry(entry: unknown, index: number): InlineCommentEntry {
  const at = `--comments-file entry ${index}`;
  if (typeof entry !== "object" || entry === null) {
    throw axiError(`${at} must be an object`, "VALIDATION_ERROR", COMMENTS_FILE_SUGGESTION);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.body !== "string") {
    throw axiError(`${at} needs a string \`body\``, "VALIDATION_ERROR", COMMENTS_FILE_SUGGESTION);
  }
  const isReply = record.reply_to !== undefined;
  const isNew = record.path !== undefined || record.line !== undefined;
  // The two shapes are exclusive: an entry carrying both a `reply_to` and a
  // `path`/`line` is contradictory (a reply needs neither), so it is rejected
  // rather than silently resolved to one arm.
  if (isReply && isNew) {
    throw axiError(
      `${at} mixes a reply (\`reply_to\`) with a new comment (\`path\`/\`line\`) — use one shape`,
      "VALIDATION_ERROR",
      COMMENTS_FILE_SUGGESTION,
    );
  }
  if (isReply) {
    if (typeof record.reply_to !== "number") {
      throw axiError(`${at} \`reply_to\` must be a number`, "VALIDATION_ERROR", COMMENTS_FILE_SUGGESTION);
    }
    return { reply_to: record.reply_to, body: record.body };
  }
  if (typeof record.path === "string" && typeof record.line === "number") {
    return { path: record.path, line: record.line, body: record.body };
  }
  throw axiError(
    `${at} must be a reply (\`reply_to\`) or a new comment (\`path\` + \`line\`)`,
    "VALIDATION_ERROR",
    COMMENTS_FILE_SUGGESTION,
  );
}

/**
 * Map validated inline-comment entries onto the review-submission payload's
 * `comments[]`. A new comment goes straight through — its new-file `line`
 * becomes `new_position` (always the new side). A reply is resolved against the
 * PR's existing review comments (one reviews-plus-comments fan-out, only when a
 * reply is present): its target is found by id, and that comment's anchor is
 * reconstructed from its own `diff_hunk` so the reply threads onto the same
 * line. A `reply_to` id absent from the PR is a `VALIDATION_ERROR`.
 */
export async function resolveInlineComments(
  api: GiteaClient,
  context: RepoContext,
  number: number,
  entries: InlineCommentEntry[],
): Promise<CreatePullReviewComment[]> {
  const hasReply = entries.some((entry) => "reply_to" in entry);
  const existing = hasReply ? await fetchAllReviewComments(api, context, number) : [];

  return entries.map((entry) => {
    if ("reply_to" in entry) {
      const target = existing.find((comment) => comment.id === entry.reply_to);
      if (target === undefined) {
        throw axiError(
          `--comments-file reply_to ${entry.reply_to} is not a review comment on this pull request`,
          "VALIDATION_ERROR",
        );
      }
      // The target's path and diff_hunk are what re-anchor the reply; a comment
      // returned without them is a broken answer, not a reply we can invent an
      // anchor for (mirroring the other "never fabricate" guards).
      if (target.path === undefined || target.diff_hunk === undefined) {
        throw axiError(
          `Gitea returned review comment ${entry.reply_to} without the path/diff_hunk needed to anchor a reply`,
          "UNKNOWN",
        );
      }
      return { path: target.path, ...anchorFromDiffHunk(target.diff_hunk), body: entry.body };
    }
    return { path: entry.path, new_position: entry.line, body: entry.body };
  });
}
