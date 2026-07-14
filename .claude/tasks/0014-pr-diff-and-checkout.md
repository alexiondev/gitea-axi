---
spec: gitea-axi
blocked-by: 0003-issue-view-and-truncation
---

## What to build

The two PR commands that touch content and the local worktree: `pr diff` and `pr checkout`.
`pr diff <n>` fetches the raw diff from the `.diff` endpoint and truncates at 4000 chars, signaling truncation with separate `truncated: true` and `original_length: N` fields (not an inline hint) plus a prepended `--full` suggestion; `--full` suppresses diff truncation.
Output: `pr_diff: { number, diff[, truncated, original_length] }`.
`pr checkout <n>` reads the PR head branch name from the PR fetch, then fetches `refs/pull/{n}/head` from origin — which works uniformly for same-repo and fork PRs (see ADR 0011) — three-cased on local branch state so re-checkout is idempotent:
absent branch → fetch into it and check out; existing unchecked-out branch → force-fetch (the branch mirrors the PR head) and check out; currently checked-out branch → plain fetch then `--ff-only` merge, failing with `GIT_ERROR` and a divergence explanation if local commits diverge — never discarding them silently.
This slice introduces `GIT_ERROR`: non-zero git subprocess exits map to it, carrying git's first stderr line and a remediation help line.
Output: `checkout: { number, branch, status: "ok" }`.

## Acceptance criteria

- [x] `pr diff <n>` outputs the diff, adding `truncated: true` and `original_length` when over 4000 chars plus a `--full` next-step suggestion; `--full` returns the raw diff
- [x] `pr checkout <n>` handles all three local-branch cases and re-running it is idempotent
- [x] A checked-out branch that has diverged from the PR head fails with `GIT_ERROR` and an explanatory help line, leaving local commits intact
- [x] Other git failures (dirty worktree, network) map to `GIT_ERROR` with git's first stderr line
- [x] Checkout works for a fork PR whose head repo is not a configured remote (via `refs/pull/{n}/head`)
- [x] Tests cover diff truncation boundaries and the three checkout cases (git behavior exercised against a scratch repository, API responses from the fixture server)

## Implementation Notes

The raw diff is fetched through the generated client's `repoDownloadPullDiffOrPatch`, but with `{ format: "text" }` forced per call.
The `giteaApi` wrapper sets `baseApiParams.format: "json"`, so every response otherwise runs through `response.json()` — which would discard a plain-text `.diff` body and leave `data` null.
Forcing `text` reads the diff verbatim.

To let the fixture server return a non-JSON diff body, `FixtureServer`'s route gained a `raw?: string` field, served verbatim as `text/plain` (bypassing the `JSON.stringify` the other fields get).

`PULL_PATH` in `src/errors.ts` was widened from `(\d+)(?:\/|$)` to `(\d+)(?:[./]|$)` so a 404 on `/pulls/{n}.diff` still classifies as `PR_NOT_FOUND` rather than falling through to `REPO_NOT_FOUND` — the diff endpoint's number is followed by a `.` suffix rather than a `/` or end-of-path.

Diff truncation is its own `truncateDiff` in `src/diff.ts`, deliberately not reusing `truncateBody`: it signals the cut with separate `truncated`/`original_length` fields (so the diff text stays a verbatim prefix) rather than the inline hint bodies use, and does no body-cleaning.

For the checked-out-and-diverged case, git's `merge --ff-only` prints its `hint:` lines to stderr before the `fatal:` line, so the surfaced `GIT_ERROR` message is that first `hint:` line; the plain-language divergence explanation and remediation live in the help lines, which is where the acceptance criterion's "explanatory help line" is asserted.
This matches the spec's "carrying git's first stderr line" literally.

`runGit` (the shared git-runner that maps a non-zero exit to `GIT_ERROR` with git's first stderr line) gained an optional `fallbackMessage` argument during the `/review-uncommitted` pass, so the `merge --ff-only` step routes through it instead of re-implementing the enoent/non-zero mapping inline (a Duplicated-Code judgement call the Standards axis raised).

Process note: `/implement` front-loaded the implementation before the test-writer sub-agent authored the tests, so each TDD cycle was green-on-first-run rather than red-first.
Every test was still authored independently by a `general-purpose` sub-agent from the public CLI interface alone (it never read the implementation source), one behavior at a time.
