---
spec: benchmark-harness
blocked-by: [0022-bench-scaffold-and-result-store, 0028-bench-task-suite]
---

## What to build

The aggregator that renders the accumulated sample store into a readable comparison, rendering whatever exists and annotating incomplete coverage rather than blocking on a complete matrix.

The headline table has one row per arm: cost-equivalent tokens as the headline, then raw tokens, turns, duration, success rate, and a coverage figure, with imputed cost shown as a de-emphasized secondary column. Cost-equivalent tokens are computed at render time by weighting each run's four retained components by Anthropic's published API pricing ratios (see the cost-equivalent-token-metric ADR), so the stored records can be re-weighted without re-running if the subscription's accounting is ever documented. Partially-run cells are annotated rather than hidden.

Supporting views derived from the same records include a per-tier breakdown, a per-token-component breakdown, and the separate bonus table for the capability-asymmetric operations. The aggregator is a pure seam, unit-tested against synthetic sample stores.

## Acceptance criteria

- [x] The headline table renders one row per arm with cost-equivalent tokens as the headline, plus raw tokens, turns, duration, success rate, coverage, and imputed cost as a de-emphasized secondary column.
- [x] Cost-equivalent tokens are computed from the retained four components at render time using the documented pricing-ratio weights.
- [x] A partial matrix renders without error and incomplete coverage is annotated rather than hidden or treated as complete.
- [x] Per-tier and per-token-component breakdowns and the separate bonus table are rendered from the same records.
- [x] Rendering is stable and unit-tested against a synthetic append-only sample store.

## Implementation Notes

- The aggregator lives in `bench/aggregate.ts` as a pure seam: `aggregate` rolls a flat record list up against the task definitions into a `Report` (headline, per-tier and per-token-component breakdowns, and the bonus table), and `renderReport` renders that report as stable text. `readAllSamples(store)` drains a `SampleStore` into the record list the aggregator consumes, so the whole pipeline is `renderReport(aggregate({ records: readAllSamples(store), suite, bonus }))`.
- Cost-equivalent tokens are computed at render time from `COST_EQUIVALENT_WEIGHTS` (fresh input 1×, cache-write 1.25×, cache-read 0.1×, output 5×, per ADR 0014). The 1.25× cache-write weight is the 5-minute-TTL multiplier: the stored record retains a single un-TTL'd `cacheCreation` component, so the default write price applies. Documented at the constant.
- `aggregate` takes the suite as `TaskCoverage = Pick<BenchTask, "id" | "tier">` rather than the full `BenchTask`, since the aggregator only needs each task's id (to key cells) and tier (to group), never its scoring function. The real scored suite satisfies this, and tests can pass bare `{ id, tier }` lists. Coverage is scored against the full suite per arm, so a cell is `covered` at or above the reporting floor, `partial` below it, and `missing` at zero — the three always sum to the task count, which is what keeps a half-run matrix from reading as complete.
- Metrics are per-run means over an arm's samples; every mean is `number | null`, with `null` (rendered as an em dash) for an arm or cell with no samples, so an unrun arm is never shown as a zero. Success rate is the passing fraction.
- The bonus table renders one row per bonus definition carrying its capability metadata (operation, direction, note, and gitea-axi's own applicability), plus per-arm run metrics only for arms that actually have samples for that bonus cell — usually none, since the runner drives only the scored suite. This is the honest "from the same records" reading without inventing per-arm applicability the `BonusTask` model does not carry.
- Scope: this task delivers the aggregator seam only. No CLI wrapper was built — `bench/` slices split their command wiring into their own tasks (task 0029 was the dedicated run-loop CLI), so a `bench:report` command over this seam is flagged as a natural follow-up in `bench/README.md` rather than folded in here. All five acceptance criteria are about the pure aggregator, which is fully implemented and unit-tested (9 tests, including an append-order-stability test driving two real `createSampleStore` instances).
- Review (three-axis, `/review-uncommitted`): Risk overall Low. Spec axis clean — faithful and complete, weights correct per ADR 0014, coverage annotated not hidden. Standards axis found no hard violations, only judgement-call smells (Duplicated Code / Data Clumps / Repeated Switches across the four aggregation passes); left as deliberate trade-offs — the reviewer noted the flat per-pass form is readable and the view interfaces genuinely diverge, and the shared cost-equivalent-mean was already factored into `meanCostEquivalent`.
