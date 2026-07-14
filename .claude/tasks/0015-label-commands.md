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

- [x] `label list` renders the count line and `labels:` block; empty repos get the explicit empty state
- [x] `label create --name --color` creates the label, prepending `#` to the color, and outputs `created: ok` + `label: <name>`
- [x] Creating an existing label (case-insensitive) outputs `create: already_exists` + the existing name, exit 0
- [x] `label edit <name>` applies `--name`/`--color`/`--description` and outputs `edit: ok` + the resulting name
- [x] `label edit`/`label delete` on an unknown name yield `VALIDATION_ERROR` (exit 2)
- [x] `label delete <name>` outputs `delete: ok` + `label: <name>`
- [x] Fixture-server tests cover create, idempotent re-create, edit, delete, and the unknown-name refusals

## Implementation Notes

Built the `label` group in `src/commands/label.ts`, wired into `src/cli.ts` (dispatcher plus the two most-common entries in the top-level help), following the sibling `issue`/`pr` command patterns.

Deviations and decisions:

- **`label edit` requires at least one change.**
The spec/gh-axi reference leaves all edit flags optional, but sending an empty `PATCH` is a pointless call, so an edit with none of `--name`/`--color`/`--description` is refused with `VALIDATION_ERROR` — mirroring `issue edit`'s "requires at least one change" guard for consistency within gitea-axi.
- **Resulting name for `edit`/`create`/`delete` comes from the API response** (`edited.name`, `label.name`), not the input, so the reported name is the server's canonical echo (correct casing, and the unchanged original when `--name` was omitted).
- **`create` vs `created` output keys.**
The success key is `created: ok` and the idempotent-hit key is `create: already_exists` — two different top-level keys.
This is spec-mandated (spec lines 342–343) rather than the `already: true` shape the dependency no-ops use; kept verbatim to match the fixed contract.
- **Flat `renderObject` output shape.**
Added `renderObject(item, help)` to `src/render.ts` because the label create/edit/delete outputs are flat top-level fields (`created: ok` / `label: <name>`), which the sibling `renderDetail` (nests under a `noun:` block) cannot produce. This is the spec's output shape, not a new convention chosen freely.
- **Shared lookup + positional helpers (cleanups from review).**
Extracted `findLabel`/`resolveLabel` and a shared `labelNotFound` message into `src/lookup.ts`, reused by the existing `resolveLabelIds`; and extracted `parseSinglePositional` in `src/flags.ts`, now shared by `parsePositionalNumber` and the label name positionals, removing the duplicated count-check/error scaffolding.
- **`label list` uses a single-page fetch with `--limit` (default 500)**, reading `X-Total-Count` for the count line, rather than the exhaustive pagination `resolveLabel`/`resolveLabelIds` use; the spec asks only for `--limit`, and a repo with >500 labels is signalled by the `count: N of T total` line.
