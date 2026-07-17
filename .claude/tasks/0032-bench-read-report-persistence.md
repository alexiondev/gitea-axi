---
spec: read-tier-accuracy
---

## What to build

Persist the agent's final report on the benchmark result record for read tasks, so a failed read is diagnosable directly from the stored record instead of only carrying an opaque `incorrect` tag.

The report is already in hand where the runner scores a read task — threading it into the assembled record is all that is required; the sample store serializes whatever record it is handed and needs no change of its own.

Mutation tasks are scored by diffing repository state and have no agent report, so the field is populated for read tasks and absent otherwise.

## Acceptance criteria

- [x] The result record carries the agent's final report for read tasks.
- [x] The field is absent on records for mutation tasks.
- [x] A completed read cell produces a record whose report is the agent's final report; a mutation cell produces a record without one — asserted at the runner's record-assembly seam.
- [x] The sample store round-trips the report-bearing record without any change to the store itself.
- [x] Existing runner and store tests still pass.

## Implementation Notes

- `ResultRecord` gained an optional `report?: string`. The runner resolves the scoring spec once in `runCell` and records `run.finalReport` only when `spec.kind === "read"`, so the field is populated for read tasks and absent otherwise. `makeRecord` conditionally spreads the key (`...(report !== undefined ? { report } : {})`) so a mutation (or hung) record genuinely omits it rather than carrying `report: undefined`; verified by `expect(sample).not.toHaveProperty("report")` after the JSON round-trip.
- `scoreRun` was refactored to take a pre-resolved `ScoringSpec` instead of a `BenchTask`. This is marginally more than "thread the value into the record," but it is the minimal clean way to branch on `spec.kind` in `runCell` without calling `task.scoringSpec(owner)` twice.
- The store needed no change, as the spec predicted: it serializes whatever record it is handed, so the round-trip test passed on first run.
- Two review findings were left as deliberate judgement calls (both non-blocking baseline smells, no documented-standard breach): the `makeRecord` positional parameter list (extended by one param in the module's pre-existing positional style, kept consistent with surrounding code rather than refactored to an options object), and the two `spec.kind` branches a few lines apart in `runCell` and `scoreRun` (they select different things — the report vs. the scorer — and read clearer inline).
