---
spec: gitea-axi
blocked-by: 0004-issue-create-and-comment
---

## What to build

The label command group: `label list`, `label create`, `label edit`, `label delete`.
`label list` takes `--limit` (default 500) and outputs a count line plus `labels: [ { name } ]`.
`label create` requires `--name` and `--color` (hex without `#`; the `#` is prepended before the API call) with optional `--description`; it is idempotent via a case-insensitive existence check, reporting `create: already_exists` instead of failing.
`label edit <name>` and `label delete <name>` resolve the positional name via the standard case-insensitive label lookup with `VALIDATION_ERROR` when not found.
`label delete` is deliberately not idempotent — a nonexistent label is refused rather than reported as success (see ADR 0010).

## Acceptance criteria

- [ ] `label list` renders the count line and `labels:` block; empty repos get the explicit empty state
- [ ] `label create --name --color` creates the label, prepending `#` to the color, and outputs `created: ok` + `label: <name>`
- [ ] Creating an existing label (case-insensitive) outputs `create: already_exists` + the existing name, exit 0
- [ ] `label edit <name>` applies `--name`/`--color`/`--description` and outputs `edit: ok` + the resulting name
- [ ] `label edit`/`label delete` on an unknown name yield `VALIDATION_ERROR` (exit 2)
- [ ] `label delete <name>` outputs `delete: ok` + `label: <name>`
- [ ] Fixture-server tests cover create, idempotent re-create, edit, delete, and the unknown-name refusals
