# Hard deletes refuse missing targets instead of reporting idempotent success

`issue delete` on a nonexistent issue errors with `ISSUE_NOT_FOUND`; `label delete` on a nonexistent label errors with `VALIDATION_ERROR`.
This deliberately narrows a literal reading of AXI Principle 6 ("mutations should be idempotent").

## Considered Options

**Idempotent success ("already deleted")** (rejected) — Consistent with the literal principle text and with the silent-success behavior of `--remove-label` and `blocks remove`.
But a missing hard-delete target usually means the agent's world-model is wrong (wrong number, wrong repo), and reporting success would confirm a false belief — the agent walks away thinking it deleted something it never identified correctly.

**Refuse with a specific error** (chosen) — Matches gh-axi's behavior for both commands.
The destructive command is exactly the one that should refuse to guess.

## The dividing line

Relationship removals (`--remove-label`, `blocks remove`, `blocked-by remove`) stay silent-success: the *entity* was correctly identified and fetched; only the relationship is absent, so the desired end state already holds.
Hard deletes error: the *target itself* is missing, which signals a stale or wrong reference rather than an already-achieved goal.

## Consequences

- `issue delete <n>` on a missing issue → `ISSUE_NOT_FOUND` (falls out of the path-based 404 classification automatically).
- `label delete <name>` on a missing label → `VALIDATION_ERROR`, consistent with every other label-name lookup.
- Principle 6's idempotency guarantee is scoped in the spec: state transitions and relationship add/removes are idempotent; hard deletes are not.
