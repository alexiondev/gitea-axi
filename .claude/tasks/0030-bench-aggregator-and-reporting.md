---
spec: benchmark-harness
blocked-by: [0022-bench-scaffold-and-result-store, 0028-bench-task-suite]
---

## What to build

The aggregator that renders the accumulated sample store into a readable comparison, rendering whatever exists and annotating incomplete coverage rather than blocking on a complete matrix.

The headline table has one row per arm: cost-equivalent tokens as the headline, then raw tokens, turns, duration, success rate, and a coverage figure, with imputed cost shown as a de-emphasized secondary column. Cost-equivalent tokens are computed at render time by weighting each run's four retained components by Anthropic's published API pricing ratios (see the cost-equivalent-token-metric ADR), so the stored records can be re-weighted without re-running if the subscription's accounting is ever documented. Partially-run cells are annotated rather than hidden.

Supporting views derived from the same records include a per-tier breakdown, a per-token-component breakdown, and the separate bonus table for the capability-asymmetric operations. The aggregator is a pure seam, unit-tested against synthetic sample stores.

## Acceptance criteria

- [ ] The headline table renders one row per arm with cost-equivalent tokens as the headline, plus raw tokens, turns, duration, success rate, coverage, and imputed cost as a de-emphasized secondary column.
- [ ] Cost-equivalent tokens are computed from the retained four components at render time using the documented pricing-ratio weights.
- [ ] A partial matrix renders without error and incomplete coverage is annotated rather than hidden or treated as complete.
- [ ] Per-tier and per-token-component breakdowns and the separate bonus table are rendered from the same records.
- [ ] Rendering is stable and unit-tested against a synthetic append-only sample store.
