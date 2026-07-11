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

- [ ] `issue delete <n>` outputs `issue: { number, status: "deleted" }` on success
- [ ] Deleting a nonexistent issue yields `ISSUE_NOT_FOUND` (exit 1), not idempotent success
- [ ] `issue pin <n>` outputs `issue: { number, state, pinned }`; pinning an already-pinned issue returns early with `message: "Already pinned"` and exit 0
- [ ] `issue unpin <n>` mirrors pin with `message: "Already unpinned"` on the no-op
- [ ] Fixture-server tests cover delete success, delete-missing refusal, and both pin/unpin no-ops
