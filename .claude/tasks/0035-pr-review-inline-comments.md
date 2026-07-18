---
spec: pr-review-comments
blocked-by: 0034-pr-review-anchor-fields
---

## What to build

Give `pr review <n>` a `--comments-file <path>` flag carrying a JSON array of inline comments submitted as part of the review.
The existing action flag (exactly one of `--approve` / `--request-changes` / `--comment`) is still required, and top-level `--body` / `--body-file` stays optional, so an agent can approve/request-changes/comment while attaching inline replies.

Each array entry is one of two shapes, with no `side` field anywhere:

- New comment: `{ "path": "...", "line": <new-file line>, "body": "..." }` — `line` maps to `new_position`; it is always the new side, because a line addressable by new-file number is by definition on the new side.
- Reply: `{ "reply_to": <comment-id>, "body": "..." }` — carries no line or side.
  gitea-axi locates the target comment (no get-comment-by-id endpoint exists, so it reuses the same reviews-plus-comments fan-out the read side performs), reconstructs that comment's anchor from its own `diff_hunk`, and posts a matching inline comment; because Gitea threads comments by line, a same-line post joins the existing conversation, so side is inferred from the target rather than supplied.

All entries map onto the `comments[]` array of the review-submission payload (each element `{ path, new_position | old_position, body }`), which the SDK already accepts but gitea-axi previously left unpopulated — no new HTTP layer or endpoint is added.
A `reply_to` id not found among the PR's review comments is a `VALIDATION_ERROR` raised before submission, mirroring how `pr review` validates its action flags up front.
Mutation output follows the established action-block/entity-block convention; the inline-comment count is reflected in the reported result.

## Acceptance criteria

- [x] `pr review N --comment --comments-file <f>` submits a review whose payload `comments[]` reflects the file's entries
- [x] A new-comment entry maps `line` to `new_position` on the given `path`, always the new side
- [x] A reply entry (`reply_to`) posts an inline comment whose anchor is reconstructed from the target comment's `diff_hunk`, with side inferred from the target (no `side` field consumed)
- [x] The action flag remains required and top-level `--body` / `--body-file` still composes with the inline batch
- [x] A `reply_to` id absent from the PR's review comments yields `VALIDATION_ERROR` (exit 2) before any submission request is made
- [x] The mutation output reflects the inline-comment count in its result
- [x] Fixture-server tests assert the captured submission body's `comments[]` for both the new-comment (`path` + `new_position`) and reply (reconstructed anchor) cases, the `VALIDATION_ERROR` no-request failure path, and the action-block output

## Implementation Notes

- `--comments-file` parsing/validation and payload mapping live in a new module `src/review-comments.ts`. `loadInlineComments` reads and shape-validates the JSON batch up front (before any client is created); `resolveInlineComments` maps entries onto `CreatePullReviewComment[]`.
- The reply anchor is reconstructed by `anchorFromDiffHunk` in `src/diff.ts` (beside `trimDiffHunk`): it walks the unified-diff hunk — whose last line is the commented line, by Gitea's convention — tracking old/new line numbers, and reads the last line off. An added/context last line anchors on `new_position`; a deleted last line on `old_position`. Both sides are covered by tests.
- The reply-target lookup reuses a new `fetchAllReviewComments` in `src/review.ts` — the reviews-plus-comments fan-out the read side already performs — since Gitea has no get-comment-by-id endpoint. It only runs when a reply is present; a new-comment-only batch makes no extra GETs.
- The submitted count rides the action block as `review: { number, action, comments: N }`, added only when a batch was submitted so a plain review's output is unchanged.
- The action-flag-required criterion needed no new test: `resolveReviewAction` still runs first, so the existing zero/multiple-action tests cover it unchanged even with `--comments-file` present.

Review follow-ups (`/review-uncommitted`), all addressed in this branch:

- Standards flagged `readCommentsFile` as duplicating `body-source.ts`'s `readBodyFile`. Extracted the shared path-resolve-and-read into `src/flag-file.ts` (`readFlagFile`); both `--body-file` and `--comments-file` now go through it, keeping their flag-specific error messages.
- Spec flagged that an entry mixing both shapes (`reply_to` + `path`/`line`) was silently resolved to a reply. `validateEntry` now rejects the contradictory mix as a `VALIDATION_ERROR` up front (with a regression test), making the two-shape contract exact.
- Spec flagged the `target.path ?? ""` fallback as a silent mis-anchor. A reply target returned without `path`/`diff_hunk` now raises `UNKNOWN` instead of posting an empty path, mirroring the repo's other "never fabricate an anchor/identifier" guards.
