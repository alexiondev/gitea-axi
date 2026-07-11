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
