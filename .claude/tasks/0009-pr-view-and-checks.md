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

- [ ] `pr view <n>` renders the default fields including `checks`, `comment_count`, and `review_count` from the three-call fetch pattern
- [ ] Commit-status states map to the four conclusions per the spec, `warning` counting as failure
- [ ] A PR with no statuses renders the `"0 passed, 0 failed — this PR has no CI checks configured"` message in both commands
- [ ] `--reviews` lists reviews with `official` and `stale` fields plus their inline comments
- [ ] `--comments` and `--full` behave as on `issue view` (800-char comment truncation with cleanBody; `--full` suppresses everything)
- [ ] `pr checks <n>` outputs the summary line followed by `{ name, conclusion }` rows
- [ ] A nonexistent PR yields `PR_NOT_FOUND` (exit 1)
- [ ] Fixture-server tests cover the status mapping including `skipped` and `warning`, the no-CI case, `--reviews`, and truncation behavior
