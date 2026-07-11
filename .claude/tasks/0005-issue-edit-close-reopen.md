---
spec: gitea-axi
blocked-by: 0004-issue-create-and-comment
---

## What to build

The issue state-transition mutations: `issue edit`, `issue close`, `issue reopen`.
`issue edit <n>` supports `--title`, `--body`/`--body-file`, `--add-label`, `--remove-label`, `--add-assignee`, `--remove-assignee`, and `--milestone` (name-resolved).
Label mutations use Gitea's dedicated additive/removal label endpoints: `--add-label` passes the name directly (no lookup); `--remove-label` resolves the name to an ID case-insensitively, erroring if the label does not exist in the repo, and treating Gitea's 404 for a label not applied to the issue as silent success.
Assignee mutations introduce fetch-then-patch: read the current assignee list, apply the change in-process, send the full resulting list in one PATCH (see ADR 0007).
`issue close <n>` PATCHes `state: "closed"`, with optional `--comment` as a second API call whose failure is surfaced rather than swallowed; `--reason` is excluded.
`issue reopen <n>` PATCHes `state: "open"`.
All three use the action-block pattern on success (`edited:`/`closed:`/`reopened:` with `{ number, status: "ok" }`) — a deliberate departure from gh-axi's entity block on `issue edit` — and close/reopen return early with an `Already closed`/`Already open` message when a no-op.

## Acceptance criteria

- [ ] `issue edit` applies title, body, and milestone changes and outputs `edited: { number, status: "ok" }`
- [ ] `--add-label` posts the name directly to the additive label endpoint; `--remove-label` resolves the ID first, yields `VALIDATION_ERROR` for a name not in the repo, and treats a 404 for an unapplied label as silent success
- [ ] `--add-assignee`/`--remove-assignee` use fetch-then-patch, sending the full resulting assignee list in a single PATCH
- [ ] `issue close <n>` outputs `closed: { number, status: "ok" }`; with `--comment` the comment is posted after the close, and a comment-post failure surfaces as an error even though the issue is closed
- [ ] `issue close` on an already-closed issue and `issue reopen` on an already-open issue return early with `message: "Already closed"` / `message: "Already open"` and exit 0
- [ ] `issue reopen <n>` outputs `reopened: { number, status: "ok" }`
- [ ] Fixture-server tests cover each mutation path, both idempotent no-ops, the unapplied-label silent success, and the close-comment partial failure
