import type { GiteaClient } from "./client.js";
import type { RepoContext } from "./context.js";
import { axiError, classifyHttpError } from "./errors.js";

/** The raw-diff truncation limit, distinct from the body/comment limits. */
export const DIFF_TRUNCATE_LIMIT = 4000;

/**
 * A rendered pull-request diff. `truncated`/`original_length` are present only
 * when the diff was cut short — signalled as separate fields rather than an
 * inline hint, so the diff text itself stays a verbatim (if partial) prefix.
 */
export interface DiffResult {
  diff: string;
  truncated?: true;
  original_length?: number;
}

/**
 * Fetch a pull request's raw unified diff from `GET /pulls/{index}.diff`. The
 * generated client defaults every response to JSON parsing (its baseApiParams
 * set `format: "json"`), which would discard a plain-text diff body — so `text`
 * is forced per call to read the response verbatim.
 */
export async function fetchPullDiff(
  api: GiteaClient,
  context: RepoContext,
  number: number,
): Promise<string> {
  try {
    const response = await api.repos.repoDownloadPullDiffOrPatch(
      context.owner,
      context.name,
      number,
      "diff",
      undefined,
      { format: "text" },
    );
    return response.data ?? "";
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * Truncate a diff to {@link DIFF_TRUNCATE_LIMIT}, reporting the original length
 * so the caller can offer `--full`. `full` returns the raw diff untouched.
 */
export function truncateDiff(diff: string, full: boolean): DiffResult {
  if (full || diff.length <= DIFF_TRUNCATE_LIMIT) {
    return { diff };
  }
  return {
    diff: diff.slice(0, DIFF_TRUNCATE_LIMIT),
    truncated: true,
    original_length: diff.length,
  };
}

/**
 * Structurally trim a review comment's `diff_hunk` to its anchor: the `@@`
 * header line plus the hunk's last two lines. A hunk of three lines or fewer is
 * already covered by that (header + last two), so it is returned unchanged.
 *
 * This is deliberately not the char-based body truncation: it keeps both the
 * file-line anchor (the `@@` header) and the code at the comment (the tail),
 * which a keep-head char truncation would get backwards by dropping the tail.
 */
export function trimDiffHunk(hunk: string): string {
  const lines = hunk.split("\n");
  if (lines.length <= 3) {
    return hunk;
  }
  return [lines[0], ...lines.slice(-2)].join("\n");
}

/**
 * The file-line anchor of a review comment, as the side-tagged position the
 * review-submission payload wants: exactly one of `new_position` (new side) or
 * `old_position` (old side) is set.
 */
export interface HunkAnchor {
  new_position?: number;
  old_position?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reconstruct the file-line anchor of the line a review comment's `diff_hunk`
 * belongs to. Gitea builds a comment's `diff_hunk` so it ends at the commented
 * line, so the anchor is that last body line: starting from the `@@ -old +new @@`
 * header, walk the hunk tracking old- and new-file line numbers, and read the
 * last line off. An added (`+`) or context (` `) line anchors on the new side
 * (`new_position`); a deleted (`-`) line anchors on the old side (`old_position`).
 *
 * This lets a reply post a matching inline comment that threads with its target
 * without the caller supplying any line or side — Gitea joins comments on the
 * same line into one conversation.
 */
export function anchorFromDiffHunk(hunk: string): HunkAnchor {
  const lines = hunk.split("\n");
  const header = HUNK_HEADER.exec(lines[0] ?? "");
  if (header === null) {
    throw axiError(
      "Gitea returned a review comment whose diff_hunk has no @@ header to anchor a reply",
      "UNKNOWN",
    );
  }
  let oldLine = Number(header[1]);
  let newLine = Number(header[2]);
  // An empty body is degenerate; default to the header's new-side start.
  let anchor: HunkAnchor = { new_position: newLine };
  for (const line of lines.slice(1)) {
    if (line.startsWith("-")) {
      anchor = { old_position: oldLine };
      oldLine += 1;
    } else if (line.startsWith("+")) {
      anchor = { new_position: newLine };
      newLine += 1;
    } else {
      anchor = { new_position: newLine };
      oldLine += 1;
      newLine += 1;
    }
  }
  return anchor;
}
