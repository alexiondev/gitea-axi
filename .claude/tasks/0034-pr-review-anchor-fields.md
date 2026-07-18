---
spec: pr-review-comments
---

## What to build

Extend `pr view <n> --reviews` so each inline review comment carries the anchoring information an agent needs to answer and reply to it without a second API call.
Each inline-comment row gains three fields: `id` (the comment's own id, the handle replies target), `diff_hunk`, and `resolved` (`yes`/`no`, derived client-side from whether the comment's `resolver` user is populated).

`diff_hunk` renders with a bespoke **structural trim**, distinct from the char-based body truncation: by default the hunk's `@@` header line plus its last two lines, collapsed when the hunk is three lines or fewer.
This keeps both the file-line anchor (the header) and the code at the comment (the tail).
Under `--full` the entire `diff_hunk` is emitted verbatim — the hunk is never run through the body char-truncation path.

The raw `position` / `original_position` diff offsets are deliberately not surfaced.
These fields ride the existing `--reviews` fetch (reviews list plus one inline-comments fetch per review); no extra API calls are introduced.

## Acceptance criteria

- [x] Each inline-comment row under `--reviews` renders `id`, `diff_hunk`, and `resolved`
- [x] `resolved` is `yes` when the comment's `resolver` is populated and `no` otherwise
- [x] Default `diff_hunk` shows the `@@` header line plus the hunk's last two lines; a hunk of three lines or fewer renders in full
- [x] `--full` emits the entire `diff_hunk` verbatim, with no char-truncation applied to it
- [x] Raw `position` / `original_position` are not rendered
- [x] No additional API calls beyond the existing reviews-plus-per-review-comments fetch
- [x] Fixture-server tests drive `pr view N --reviews` and `--full` against reviews and inline comments carrying `id`, `diff_hunk`, and a set/unset `resolver`, asserting the rendered `id`, trimmed-vs-full `diff_hunk`, and `resolved: yes/no`

## Implementation Notes

- The structural trim lives in `src/diff.ts` as a pure `trimDiffHunk(hunk)` beside `truncateDiff`: for a hunk longer than three lines it returns the first (`@@` header) line plus the last two lines joined by newline; three lines or fewer is returned unchanged.
  `buildReviewRows` in `src/commands/pr.ts` calls it for the default path and passes `diff_hunk` verbatim under `--full`, so the hunk never touches the char-based body-truncation path.
- The inline-comment row's field order is `id, author, path, resolved, diff_hunk, body`, which is the TOON table header the tests assert against.
- `resolved` is `comment.resolver ? "yes" : "no"` — a truthiness check on the SDK's optional `resolver` user, matching the spec's "set / not set" derivation.
- No fresh RED for the `resolved: yes`, `--full`-verbatim, and ≤3-line-full cases: the cohesive `trimDiffHunk` helper (and the `resolver` truthiness branch) implemented in the first GREEN already covered them, so their tests were green on arrival.
  Each was proven non-vacuous with a sentinel-probe swap (per the TDD skill) and kept as a regression guard rather than dropped.
- No new API calls: the three fields ride the existing reviews-plus-per-review-comments fan-out that `--reviews` already performs.

Review follow-ups (`/review-uncommitted`), both addressed in this branch:

- Standards flagged `id: comment.id ?? 0` as fabricating an identifier — the very handle a reply copies into `reply_to`. Replaced with a `reviewCommentId` helper that throws `UNKNOWN` on a missing id, mirroring the repo's existing `pullNumber`/`headSha` "never invent an identifier" convention.
- Spec flagged the exactly-four-line trim boundary (the shortest hunk the `<= 3` guard actually trims) as untested. Added a regression test for it; a `<= 4` off-by-one would now fail.
