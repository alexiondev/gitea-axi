# pr checkout fetches refs/pull/{index}/head, not the head branch name

`pr checkout <n>` runs `git fetch origin pull/<n>/head:<branch>` (branch named from the PR's `head.ref`) followed by `git checkout <branch>`.

## Considered Options

**`git fetch origin <head-branch>`** (rejected — original spec draft) — Fails structurally for fork PRs: the head branch lives in the contributor's fork, which is not a configured remote in the operator's clone.
This is not an edge case; fork PRs are the default contribution model.

**Add the fork as a remote dynamically** (rejected) — Mutates the user's git configuration, requires cleanup, and needs credentials for the fork's clone URL.

**Fetch `refs/pull/{index}/head` from the base repo** (chosen) — Gitea, like GitHub, exposes every PR's head commit on the *base* repository under `refs/pull/{index}/head`, whether the head branch lives in the same repo or a fork.
One uniform code path, no remote mutation, no fork credentials.

## Consequences

- Same-repo and fork PRs check out identically.
- Git subprocess failures (dirty worktree, network) classify as `GIT_ERROR`, carrying git's first stderr line.
- The created local branch does not track the contributor's fork; pushing back to a fork branch is out of scope.

## Amendment (2026-07-10): three-case handling for existing local branches

The original two-step pipeline fails on re-checkout: git refuses to fetch into the currently checked-out branch, and a moved PR head makes the plain fetch non-fast-forward — so the second run of the same command errored, violating Principle 6.

Amended behavior:
1. Branch absent — original pipeline unchanged.
2. Branch exists, not checked out — force-fetch (`+pull/<n>/head:<branch>`) then checkout; the local branch is defined as a mirror of the PR head.
3. Branch currently checked out — fetch `pull/<n>/head` then `git merge --ff-only FETCH_HEAD`; divergence (local commits not on the PR head) surfaces as `GIT_ERROR` with explanatory help rather than being silently discarded.

A force-reset-always variant was rejected: fully idempotent but silently destroys local commits, which is unacceptable for unattended agents.
