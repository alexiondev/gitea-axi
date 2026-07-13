---
spec: gitea-axi
blocked-by: [0003-issue-view-and-truncation, 0008-pr-list]
---

## What to build

`pr view <n>` and `pr checks <n>`, built on the truncation machinery and the reviewDecision computation from earlier slices.
`pr view` always makes three API calls — the PR fetch and the reviews fetch in parallel, then the combined commit status once the head SHA is known — so default output includes `number`, `title`, `state`, `author`, `draft`, `merged`, `checks`, `body` (truncated at 500), `comment_count`, and `review_count` without extra flags.
The `checks` field renders as the summary string (`N passed, N failed[, N skipped][, N pending], N total`) or the explicit no-CI message; commit-status states map `success`→`pass`, `failure`/`error`/`warning`→`fail`, `skipped`→`skip`, `pending`→`pending`.
`--reviews` additionally fetches per-review inline comments and exposes Gitea-specific `official` and `stale` fields; `--comments` renders all comments at the 800-char truncation; `--full` suppresses all truncation.
`pr checks <n>` outputs the same summary line followed by a `checks` list of `{ name, conclusion }`.

## Acceptance criteria

- [x] `pr view <n>` renders the default fields including `checks`, `comment_count`, and `review_count` from the three-call fetch pattern
- [x] Commit-status states map to the four conclusions per the spec, `warning` counting as failure
- [x] A PR with no statuses renders the `"0 passed, 0 failed — this PR has no CI checks configured"` message in both commands
- [x] `--reviews` lists reviews with `official` and `stale` fields plus their inline comments
- [x] `--comments` and `--full` behave as on `issue view` (800-char comment truncation with cleanBody; `--full` suppresses everything)
- [x] `pr checks <n>` outputs the summary line followed by `{ name, conclusion }` rows
- [x] A nonexistent PR yields `PR_NOT_FOUND` (exit 1)
- [x] Fixture-server tests cover the status mapping including `skipped` and `warning`, the no-CI case, `--reviews`, and truncation behavior

## Implementation Notes

- The checks machinery lives in a new `src/checks.ts`: `summarizeChecks` (pure state→conclusion mapping + summary line) and `fetchChecks` (I/O shell), so `pr view` renders only the summary line while `pr checks` renders the summary plus the `{ name, conclusion }` rows from the same core. Unknown/future commit-status states fall through to `pending` rather than being reported as a pass or fail they are not.
- `pr checks` output shape follows gh-axi: when checks exist, the summary is the lead line above a `checks` list block (rendered via `renderList`'s lead-line slot); when none exist, a scalar `checks: <message>` line. A new generic `renderScalar(noun, value, help)` in `src/render.ts` emits that literal line + help, keeping the value unquoted (as TOON reads a string scalar to end of line), matching the summary line's treatment.
- `pr view` uses the three-call pattern from ADR 0006: the PR and its reviews are fetched in parallel, then the combined status once the head SHA is known. `review.ts` grew `fetchReviews` (raw reviews, now the shared base of `fetchReviewDecision`) and `fetchReviewComments` (per-review inline comments for `--reviews`).
- `commentRows` was extracted from `issue.ts` into `src/comment.ts` and is now shared by `issue view --comments` and `pr view --comments`, removing the duplicate row builder.
- `merged` renders as `no` when open, or the merge time (relative) once merged, matching gh-axi's "no / mergedAt value" behavior.
- Review inline-comment rows (`{ author, path, body }`) are built inline in `buildReviewRows` rather than through the shared `commentRows` (`{ author, created, body }`): they are a different entity (`PullReviewComment`, with `path` and no displayed timestamp), so forcing reuse would have meant parameterizing the middle field — a shared helper here would obscure more than it saves. Flagged by the Standards review as a judgement call; kept separate deliberately.
- The no-CI summary is labeled `summary:` when checks exist but `checks:` when none do. This matches the spec's literal empty-state form (`checks: "0 passed, 0 failed — …"`, spec line 292) and gh-axi's shape, so the label difference is intentional rather than an inconsistency.
