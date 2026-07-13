import type { Comment } from "gitea-js";
import { COMMENT_TRUNCATE_LIMIT, truncateBody } from "./body.js";
import type { FlagSpec } from "./flags.js";
import { relativeTime } from "./time.js";

/**
 * The one comment-posting shape `issue comment` and `pr comment` share. ADR 0008
 * requires both to emit the same `comment` block with the same schema, so the
 * block is built in exactly one place; what the two commands genuinely differ on
 * — how a missing target is reported, and what to suggest next — stays with them.
 */

export const COMMENT_FLAGS: FlagSpec = {
  "--body": { takesValue: true },
  "--body-file": { takesValue: true },
  "--full": { takesValue: false },
};

export interface CommentItemOptions {
  /** The issue or pull request commented on — not the comment's own id. */
  number: number;
  /** Echo the body untruncated, as `--full` asks. */
  full: boolean;
  host: string;
  now: Date;
}

/** The `comment: { number, author, created, body }` block, body truncated at 800 chars. */
export function commentItem(
  comment: Comment,
  options: CommentItemOptions,
): Record<string, unknown> {
  const body = comment.body ?? "";
  return {
    number: options.number,
    author: comment.user?.login ?? "",
    created: relativeTime(comment.created_at, options.now),
    body: options.full ? body : truncateBody(body, COMMENT_TRUNCATE_LIMIT, options.host),
  };
}

export interface CommentRowsOptions {
  host: string;
  /** Echo bodies untruncated, as `--full` asks. */
  full: boolean;
  now: Date;
}

/**
 * The `{ author, created, body }` rows for a `--comments` block, shared by
 * `issue view` and `pr view`. Each body is cleaned and truncated at 800 chars
 * unless `full` is set. Ordered author→created→body, matching the block header
 * both commands render.
 */
export function commentRows(
  comments: Comment[],
  options: CommentRowsOptions,
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
