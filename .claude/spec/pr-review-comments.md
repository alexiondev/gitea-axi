## Problem Statement

An agent doing a PR review round-trip with gitea-axi cannot complete it inside the tool.

When reading a reviewer's inline comments via `pr view --reviews`, the output gives the author, file path, and body, but not which line each comment is anchored to, nor the comment's id.
Comments like "what does this do?" or "wasn't this set earlier?" are unanswerable from the output alone, forcing a fallback to a raw Gitea API call (and scraping the token out of tea's config) just to recover the anchor.

When writing, `pr review` accepts only a single `--body` for the whole review, so "reply to each of ten inline comments" collapses into one consolidated body that restates each thread by hand, rather than a reply landing under each comment where the reviewer left it.

## Solution

Complete the read and write halves of the inline-review round-trip, both at the existing `pr` commands.

On the read side, `pr view --reviews` surfaces each inline comment's `id`, its `diff_hunk` (so the anchoring code travels with the comment), and whether the thread is already `resolved`.

On the write side, `pr review` gains a `--comments-file` flag that carries a batch of inline comments — each either a reply into an existing thread (by comment id) or a fresh comment on a new-file line — mapped onto the review-submission payload Gitea already accepts.

## User Stories

1. As a reviewing agent, I want each inline review comment's anchoring `diff_hunk` in the `--reviews` output, so that I can answer a bare "what does this do?" without a second API call.
2. As a reviewing agent, I want each inline review comment's `id` in the `--reviews` output, so that I can target that exact comment when replying.
3. As a reviewing agent, I want to see whether each inline comment's thread is already `resolved`, so that I skip settled conversations instead of re-answering them.
4. As a reviewing agent, I want the `diff_hunk` trimmed to its header line plus its last couple of lines by default, so that I get the file-line anchor and the code at the comment without paying for the whole hunk.
5. As a reviewing agent, I want `--full` to expand each `diff_hunk` to its complete text, so that I can read the entire hunk when the trimmed tail is not enough.
6. As a PR author, I want to reply to an existing inline comment by its id, so that my reply lands in that reviewer's thread without me computing any line number or side.
7. As a PR author, I want to post a fresh inline comment on a new-file line, so that I can raise a point on code no one has commented on yet.
8. As a PR author, I want to submit a batch of inline comments in one file alongside my review, so that "reply to each of ten comments" is one command, not ten.
9. As a PR author, I want gitea-axi to figure out the new-vs-old side of a reply for me, so that I never have to reason about diff sides.
10. As a PR author, I want the inline-comment batch to compose with the existing review action and optional top-level body, so that I can approve/request-changes/comment while attaching inline replies.
11. As a PR author, I want a clear validation error when a reply targets a comment id that isn't on the PR, so that a typo fails fast instead of silently posting nowhere.

## Implementation Decisions

### Read side — anchor fields on `pr view --reviews`

- The `--reviews` review rows add three fields per inline comment: `id`, `diff_hunk`, and `resolved`.
- `resolved` is `yes`/`no`, derived client-side from whether the comment's `resolver` is set (Gitea returns `resolver` as a populated user once a thread is resolved).
- The raw `position` / `original_position` diff offsets are deliberately **not** surfaced — they are diff offsets an agent cannot map to a file line without the patch, and the `diff_hunk` header already carries the human-meaningful line range.
- `diff_hunk` is rendered with a bespoke **structural trim**, not the char-based content-truncation used for bodies: by default, the hunk's `@@` header line plus its last two lines (collapsed when the hunk is three lines or fewer).
  This keeps both the file-line anchor (the `@@` header) and the code at the comment (the tail), which the keep-head char truncation would get backwards by dropping the tail.
- Under `--full`, the entire `diff_hunk` is emitted verbatim, consistent with `--full` meaning "no trimming anywhere"; the hunk is never run through the body char-truncation path.
- These fields ride the existing `--reviews` fetch (reviews list plus one inline-comments fetch per review); no extra API calls are introduced.

### Write side — `--comments-file` on `pr review`

- `pr review` gains `--comments-file <path>`, a JSON array of inline-comment entries submitted as part of the review; the existing action flag (one of `--approve` / `--request-changes` / `--comment`) is still required, and top-level `--body` stays optional.
- Each array entry is one of two shapes, and there is **no `side` field anywhere**:
  - Reply: `{ "reply_to": <comment-id>, "body": "..." }`.
  - New comment: `{ "path": "...", "line": <new-file line>, "body": "..." }`.
- A new comment maps `line` to `new_position`; it is always the new side, because a line addressable by new-file number is by definition on the new side.
  A prototype against the live host confirmed the create payload treats `new_position` as a **file line number** (not a diff offset) and that a single inline comment posts successfully this way.
- A reply carries no line or side.
  gitea-axi locates the target comment (there is no get-comment-by-id endpoint, so it reuses the same reviews-plus-comments fan-out the read side already performs), reconstructs that comment's anchor from its own `diff_hunk`, and posts a matching inline comment; because Gitea threads comments by line, a same-line post joins the existing conversation, so side is inferred from the target rather than supplied.
- All entries map onto the `comments[]` array of the review-submission payload (each element a `{ path, new_position | old_position, body }`), which the SDK already accepts but gitea-axi previously left unpopulated — no new HTTP layer or endpoint is added.
- A `reply_to` id that is not found among the PR's review comments is a `VALIDATION_ERROR` raised before submission, mirroring how `pr review` already validates its action flags up front.
- Mutation output follows the established action-block/entity-block convention for `pr review`; the inline-comment count is reflected in the reported result.

### Sequencing

- The read side ships first: it is pure read, and its surfaced `id` is the handle the write side's replies target.
- The write side ships second, on top of the id exposed by the read side.

## Testing Decisions

- Both halves are tested at the single existing **fixture-server CLI seam**: a fixture server maps request path/method to recorded Gitea JSON, the built CLI is driven via the run-CLI test helper, and assertions are on rendered `stdout` and on the recorded outbound requests.
  No new seam is introduced.
- Good tests here assert external behavior only — the exact rendered TOON lines and the captured request payload — never internal rendering helpers.
- Read side: drive `pr view N --reviews` (and again with `--full`) against fixture reviews and inline comments whose JSON carries `id`, `diff_hunk`, and a set/unset `resolver`; assert the rendered `id`, the trimmed-vs-full `diff_hunk`, and `resolved: yes/no`.
  Prior art: the existing `pr view --reviews` test that already stubs the reviews and per-review comments endpoints and asserts the `reviews[...]` block.
- Write side: write a `--comments-file` via the existing temp-file test helper, drive `pr review N --comment --comments-file <f>` against a stubbed review-submission endpoint, and assert the **captured request body's** `comments[]` (path + `new_position`, and the reply case's reconstructed anchor) plus the action-block output.
  Prior art: the existing `pr review` test that inspects the recorded POST body via the fixture server's request log, and the reply case additionally stubs the reviews-plus-comments GETs used for the lookup.
- The reply-lookup failure path is covered by asserting a `VALIDATION_ERROR` and that no submission request was made, matching the existing "rejects ... before any API call" tests.

## Out of Scope

- Resolving / unresolving review conversations (issue #39).
  Gitea exposes no REST endpoint for this — verified exhaustively against the live host — and the only mechanism is a CSRF-guarded internal web route returning HTML, which a prototype confirmed rejects token auth.
  Parked as blocked-upstream; the read side's `resolved` field covers only *seeing* resolution state, not changing it.
- A raw `api` passthrough / generic escape hatch (issue #40); dropped from this work.
- Surfacing raw `position` / `original_position` diff offsets as rendered fields.
- Inline repeatable comment flags (e.g. paired `--on path:line` / `--body`); the JSON `--comments-file` is the sole input shape.
- Old-side *new* comments authored by hand; old-side anchoring is reachable only through the reply path, where it is inferred from the target comment.

## Further Notes

- The prototype that validated the write-side `new_position` semantics left one non-removable residue on the live repo: a closed throwaway PR (#41) carrying one review comment, since Gitea cannot hard-delete PRs.
- The "no REST resolve endpoint; web-route-only and CSRF-guarded" finding for the parked #39 is recorded so it is not re-derived.
- Keeping gitea-js as the sole HTTP layer is preserved: dropping the passthrough and confining resolve to out-of-scope means no raw-request path is introduced by this work.
