---
spec: gitea-axi
blocked-by: 0005-issue-edit-close-reopen
---

## What to build

The PR-side state mutations: `pr edit`, `pr close`, `pr reopen`, mirroring the issue-side slice with two PR-specific differences.
`pr edit <n>` supports `--title`, `--body`/`--body-file`, `--add-label`/`--remove-label` (same additive-endpoint and lookup rules as issues), `--add-assignee`/`--remove-assignee` (fetch-then-patch), `--add-reviewer`/`--remove-reviewer`, `--milestone` (name-resolved), and `--base`.
Reviewer mutations cannot use fetch-then-patch — `EditPullRequestOption` has no reviewers field — so they go through Gitea's dedicated requested-reviewers POST/DELETE endpoints (see ADR 0007 amendment).
`pr close <n>` supports `--comment` with the same two-call partial-failure policy as `issue close`, and returns `pull_request: { number, state, already: true }` when already closed or merged.
`pr reopen <n>` returns `pull_request: { number, state: "open", already: true }` when already open.
Success outputs follow the action-block pattern: `edited:`/`closed:`/`reopened:` with `{ number, status: "ok" }`.

## Acceptance criteria

- [ ] `pr edit` applies title, body, milestone, and base changes and outputs `edited: { number, status: "ok" }`
- [ ] Label and assignee mutations follow the same rules as `issue edit` (additive endpoints, fetch-then-patch, unapplied-label silent success)
- [ ] `--add-reviewer`/`--remove-reviewer` call the requested-reviewers endpoints with `{ reviewers: [login] }`
- [ ] `pr close --comment` posts the comment after the PATCH and surfaces a comment failure; closing an already-closed-or-merged PR returns the entity block with `already: true`
- [ ] `pr reopen` on an open PR returns the entity block with `already: true`; otherwise outputs `reopened: { number, status: "ok" }`
- [ ] Fixture-server tests cover reviewer add/remove, the merged-PR close no-op, and the reopen paths
