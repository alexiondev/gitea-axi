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

- [x] `pr edit` applies title, body, milestone, and base changes and outputs `edited: { number, status: "ok" }`
- [x] Label and assignee mutations follow the same rules as `issue edit` (additive endpoints, fetch-then-patch, unapplied-label silent success)
- [x] `--add-reviewer`/`--remove-reviewer` call the requested-reviewers endpoints with `{ reviewers: [login] }`
- [x] `pr close --comment` posts the comment after the PATCH and surfaces a comment failure; closing an already-closed-or-merged PR returns the entity block with `already: true`
- [x] `pr reopen` on an open PR returns the entity block with `already: true`; otherwise outputs `reopened: { number, status: "ok" }`
- [x] Fixture-server tests cover reviewer add/remove, the merged-PR close no-op, and the reopen paths

## Implementation Notes

No criteria were dropped or altered; all six are satisfied.

Decisions made mid-implementation:

- The close no-op reports the actual state: `merged` for a merged PR (whose raw
  `state` Gitea reports as `closed`), otherwise the raw state — computed by a
  small `pullState` helper. `pull.state === "closed"` catches both the closed and
  merged cases for the short-circuit, matching the spec's "already closed or
  merged".
- `pr reopen` short-circuits only on `state === "open"`, per the spec. A merged
  PR (state `closed`) therefore falls through to the PATCH and Gitea rejects it as
  a `VALIDATION_ERROR` — the spec asks for no merged-guard on reopen, mirroring the
  issue side.
- Reviewer mutations are one POST for all `--add-reviewer` and one DELETE for all
  `--remove-reviewer`, each carrying the whole list — the requested-reviewers
  endpoints take arrays (ADR 0007 amendment). They are not fetch-then-patch and
  are not idempotency-checked; a redundant add/remove surfaces whatever Gitea
  answers.
- `--add-label`/`--remove-label`/`--add-assignee`/`--remove-assignee`/`--add-reviewer`/`--remove-reviewer`
  are repeatable, matching `issue edit`.
- Name resolution (milestone, remove-label ids) runs before any mutation so a typo
  is reported before a change lands. Title/body/base/milestone and the recomputed
  assignee list travel in a single PATCH; labels and reviewers use their dedicated
  endpoints afterward.
- Added a `VALIDATION_ERROR` when `pr edit` is invoked with no changes, matching
  `issue edit`.
- Review finding (Duplicated Code): extracted the fetch-then-patch merge into a
  shared `src/assignees.ts` — a pure `mergeAssignees` plus an `assigneeLogins`
  reader — now used by both `issue edit` and `pr edit`, replacing the inline copy
  that previously lived in `issue.ts`.

Follow-ups worth flagging (unaddressed review findings, both judgement calls):

- The close/reopen state-machine (read state → no-op short-circuit → PATCH `{state}`
  → render) is still duplicated between `issue.ts` and `pr.ts`. A shared helper was
  left unextracted because the two sides diverge in their no-op shape, help
  suggestions, and the PR-only merged handling, which would make the abstraction
  leaky.
- The no-op output shape differs between the issue side (`message: "Already
  closed"`) and the PR side (`already: true` + `state`). This is spec-driven — the
  spec fixes `already: true` for PRs — but the CLI's no-op output is not uniform
  across the two entities.
