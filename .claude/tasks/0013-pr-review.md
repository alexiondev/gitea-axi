---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

`pr review <n>` with the three action flags `--approve`, `--request-changes`, `--comment`, plus `--body`/`--body-file`.
Exactly one action flag is required: zero or multiple yield `VALIDATION_ERROR` before any API call, mirroring the merge shorthand-conflict rule.
Body requirements are not pre-validated locally — if Gitea rejects a body-less review event, its 422 surfaces as `VALIDATION_ERROR` with the server's message.
Output: `review: { number, action }`.

## Acceptance criteria

- [x] Each action flag submits the corresponding review event and outputs `review: { number, action }`
- [x] Zero action flags, or more than one, yield `VALIDATION_ERROR` (exit 2) with no API call
- [x] A server-side 422 for a missing body surfaces as `VALIDATION_ERROR` carrying Gitea's message
- [x] `--body-file` works as everywhere else
- [x] Fixture-server tests cover all three actions, the flag-count validations, and the 422 passthrough

## Implementation Notes

`pr review` follows the established `pr merge`/`pr comment` shape: `resolveReviewAction`
collects the set of action switches (`--approve`/`--request-changes`/`--comment`) mapped
through the `REVIEW_ACTIONS` record and raises `VALIDATION_ERROR` when the count is not
exactly one — the direct analogue of `resolveMergeMethod`'s conflicting-selector rule the
spec references, adapted from "at most one (with a default)" to "exactly one (no default)".
The action flag count is settled before `createClient`, so an invalid invocation never
reaches the API. The body flows through the shared `resolveBodySource`, so `--body`/
`--body-file` and their mutual exclusion behave as everywhere else, and no body requirement
is pre-validated locally: a body-less event Gitea rejects returns 422, which the shared
`classifyHttpError` already maps to `VALIDATION_ERROR` carrying the server's message.

Deviations from the literal spec, both deliberate:

- The success block appends a `pr view <n> --reviews` suggestion line via `renderDetail`'s
  `help`. The spec's output contract names only `review: { number, action }`; the extra
  hint is the house style every sibling mutation command (`merge`, `edit`, `close`, …)
  already follows, so it was kept for consistency rather than trimmed to the bare contract.
- A named `ReviewAction` interface was introduced in place of a repeated inline
  `{ event; action }` shape, following a Standards-axis review nit — it matches the local
  convention of naming such types (`MergeMethod`, `UpdateStyle`).

Built test-first via the `test-driven-development` skill (test-writer sub-agent, one
behavior per RED→GREEN cycle); `test/pr-review.test.ts` holds 10 tests. Full suite: 311
passing, typecheck clean.
