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

- [ ] `pr diff <n>` outputs the diff, adding `truncated: true` and `original_length` when over 4000 chars plus a `--full` next-step suggestion; `--full` returns the raw diff
- [ ] `pr checkout <n>` handles all three local-branch cases and re-running it is idempotent
- [ ] A checked-out branch that has diverged from the PR head fails with `GIT_ERROR` and an explanatory help line, leaving local commits intact
- [ ] Other git failures (dirty worktree, network) map to `GIT_ERROR` with git's first stderr line
- [ ] Checkout works for a fork PR whose head repo is not a configured remote (via `refs/pull/{n}/head`)
- [ ] Tests cover diff truncation boundaries and the three checkout cases (git behavior exercised against a scratch repository, API responses from the fixture server)
