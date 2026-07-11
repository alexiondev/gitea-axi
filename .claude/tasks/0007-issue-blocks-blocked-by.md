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

- [ ] `issue blocks list <n>` and `issue blocked-by list <n>` render their respective output blocks with count lines and explicit empty states
- [ ] `issue blocks add <n> <target>` outputs `blocks: { issue: n, blocks: target }`; `issue blocked-by add <n> <blocker>` outputs `blocked_by: { issue: n, blocked_by: blocker }`
- [ ] Adding an existing relationship returns `already: true` (fetch-first check, no duplicate POST); removing a nonexistent relationship exits 0 silently-successfully
- [ ] Self-reference and cycle rejections from Gitea surface as `VALIDATION_ERROR` (exit 2) with the server's message
- [ ] Fixture-server tests cover list, add, idempotent re-add, remove, idempotent re-remove, and a 422 cycle rejection for both groups
