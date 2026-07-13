---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

The two Gitea-specific dependency subcommand groups — `issue blocks <list|add|remove>` and `issue blocked-by <list|add|remove>` — over Gitea's blocks and dependencies endpoints.
`blocks` manages downstream dependents (issues that cannot proceed until this one is resolved); `blocked-by` manages upstream blockers.
List output blocks are `blocked_issues` and `blocking_issues`; add outputs `blocks: { issue, blocks }` / `blocked_by: { issue, blocked_by }`.
Idempotency: `add` of an existing relationship does a fetch-first check and returns `already: true`; `remove` of a nonexistent relationship is silent success; genuine validation failures (self-reference, cycles) surface as `VALIDATION_ERROR` via the 422 mapping.
No gh-axi equivalent exists — the interface shape follows this spec alone.

## Acceptance criteria

- [x] `issue blocks list <n>` and `issue blocked-by list <n>` render their respective output blocks with count lines and explicit empty states
- [x] `issue blocks add <n> <target>` outputs `blocks: { issue: n, blocks: target }`; `issue blocked-by add <n> <blocker>` outputs `blocked_by: { issue: n, blocked_by: blocker }`
- [x] Adding an existing relationship returns `already: true` (fetch-first check, no duplicate POST); removing a nonexistent relationship exits 0 silently-successfully
- [x] Self-reference and cycle rejections from Gitea surface as `VALIDATION_ERROR` (exit 2) with the server's message
- [x] Fixture-server tests cover list, add, idempotent re-add, remove, idempotent re-remove, and a 422 cycle rejection for both groups

## Implementation Notes

Both groups are one config-parameterised implementation (`DependencyGroup`): `blocks` over `/issues/{index}/blocks`, `blocked-by` over `/issues/{index}/dependencies`, differing only in endpoint calls and the spec-fixed output names (`blocked_issues`/`blocking_issues`, `blocks`/`blocked_by`).

Decisions made mid-implementation, where the spec was silent:

- **`remove` output.** The spec fixes the `add` output shape but not `remove`'s. A successful deletion reports `<noun>: { issue, <target>, removed: true }`; a no-op removal (relationship already absent) reports `already: true` instead, mirroring `add`'s no-op and honouring the action/entity-block convention (a no-op reports the already-reached state rather than claiming an action it did not perform). Both `add` and `remove` are fetch-first against the fully paginated current set, so a nonexistent issue surfaces as `ISSUE_NOT_FOUND` before any mutation.
- **`list` row fields.** Rendered as `number`, `title`, `state` — the identifying essentials; the spec did not fix a row shape.

Review follow-ups addressed in this change:

- Extracted `parseIssueNumber` into `flags.ts` so the two-positional dependency parser and the existing `parsePositionalNumber` share one positive-integer rule and message (was duplicated).
- Added test coverage for the `ISSUE_NOT_FOUND` path (issue itself absent), which the code comments claim but nothing exercised.
