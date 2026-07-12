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

- [x] `issue edit` applies title, body, and milestone changes and outputs `edited: { number, status: "ok" }`
- [x] `--add-label` posts the name directly to the additive label endpoint; `--remove-label` resolves the ID first, yields `VALIDATION_ERROR` for a name not in the repo, and treats a 404 for an unapplied label as silent success
- [x] `--add-assignee`/`--remove-assignee` use fetch-then-patch, sending the full resulting assignee list in a single PATCH
- [x] `issue close <n>` outputs `closed: { number, status: "ok" }`; with `--comment` the comment is posted after the close, and a comment-post failure surfaces as an error even though the issue is closed
- [x] `issue close` on an already-closed issue and `issue reopen` on an already-open issue return early with `message: "Already closed"` / `message: "Already open"` and exit 0
- [x] `issue reopen <n>` outputs `reopened: { number, status: "ok" }`
- [x] Fixture-server tests cover each mutation path, both idempotent no-ops, the unapplied-label silent success, and the close-comment partial failure

## Implementation Notes

No criteria were dropped or altered; all seven are satisfied.

Decisions made mid-implementation:

- The idempotent no-op for `close`/`reopen` renders an entity block — `issue: { number, state, message }` — mirroring gh-axi, since the spec's deliberate action-block departure is scoped to the *success* path only.
  Determining the no-op requires a `GET` on the issue first, which also supplies the `state` reported in that block.
- `--add-label`/`--remove-label`/`--add-assignee`/`--remove-assignee` are repeatable, matching `issue create`'s repeatable `--label`, rather than the single-valued form the spec text implies.
- Added a `VALIDATION_ERROR` when `issue edit` is invoked with no changes (documented in `--help`). The spec never specified the no-change case; this is a small justified extension, not scope creep.
- Title/body/milestone and the recomputed assignee list travel in a single PATCH; label mutations use Gitea's dedicated endpoints afterward. Name resolution (milestone, remove-label IDs) runs before any mutation so a typo is reported before a change lands.
- Extracted a shared `getIssue` helper (review finding) now used by `view`/`edit`/`close`/`reopen`.

Follow-up worth flagging: `issue close`/`reopen` do not type-guard against a PR number (unlike `issue view`), consistent with the spec, which does not require it.
