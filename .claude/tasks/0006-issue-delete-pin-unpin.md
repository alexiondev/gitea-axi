---
spec: gitea-axi
blocked-by: 0004-issue-create-and-comment
---

## What to build

The remaining simple issue mutations: `issue delete`, `issue pin`, `issue unpin`.
`issue delete <n>` hard-deletes via the DELETE endpoint (requires admin or owner permissions) and is deliberately not idempotent: a nonexistent issue errors with `ISSUE_NOT_FOUND` rather than reporting success (see ADR 0010).
`issue pin <n>` and `issue unpin <n>` call the pin endpoints and are idempotent, returning early with `Already pinned`/`Already unpinned` messages.
`issue lock`/`unlock`, `issue transfer`, and `issue subissue` remain excluded per the spec.

## Acceptance criteria

- [x] `issue delete <n>` outputs `issue: { number, status: "deleted" }` on success
- [x] Deleting a nonexistent issue yields `ISSUE_NOT_FOUND` (exit 1), not idempotent success
- [x] `issue pin <n>` outputs `issue: { number, state, pinned }`; pinning an already-pinned issue returns early with `message: "Already pinned"` and exit 0
- [x] `issue unpin <n>` mirrors pin with `message: "Already unpinned"` on the no-op
- [x] Fixture-server tests cover delete success, delete-missing refusal, and both pin/unpin no-ops

## Implementation Notes

Pin state is read from the Gitea `pin_order` field, not a boolean: Gitea has no `pinned` flag on the issue struct, and records pin position as a positive integer (`0`/absent means unpinned).
A small `isPinned` helper wraps this so the two commands don't repeat the check.
The `state` field in the pin/unpin output is the issue's own open/closed state, taken from the fetched issue — pinning never changes it.

`issue delete` runs no confirmation prompt.
The review's Risk axis rated the change High solely because of the irreversible hard delete and suggested a `--yes` guard, but this is an agent-facing CLI with structured TOON output where interactive prompts don't fit, and the spec deliberately specifies a hard, non-idempotent delete without one.
Left unguarded by design; the destructiveness is inherent to the operation, not a defect.

`issuePin` and `issueUnpin` are near-identical mirrors (flagged as a judgement-call duplication by the Standards axis).
Kept as two functions per the repo's established one-function-per-subcommand convention, which the existing `issueClose`/`issueReopen` pair already follows.
