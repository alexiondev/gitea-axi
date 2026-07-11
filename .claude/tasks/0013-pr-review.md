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

- [ ] Each action flag submits the corresponding review event and outputs `review: { number, action }`
- [ ] Zero action flags, or more than one, yield `VALIDATION_ERROR` (exit 2) with no API call
- [ ] A server-side 422 for a missing body surfaces as `VALIDATION_ERROR` carrying Gitea's message
- [ ] `--body-file` works as everywhere else
- [ ] Fixture-server tests cover all three actions, the flag-count validations, and the 422 passthrough
