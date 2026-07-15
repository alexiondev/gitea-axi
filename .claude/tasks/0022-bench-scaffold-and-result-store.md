---
spec: benchmark-harness
---

## What to build

The foundation the whole benchmark harness reads and writes: a `bench/` directory (excluded from the published npm package, alongside the existing `dist`/`skills` allow-list), the immutable result-record shape, and an append-only per-cell sample store.

A result record captures one completed `(arm, task, trial)` run: the four token components (fresh input, cache-creation, cache-read, output), the turn count, the wall-clock duration, the imputed cost, and the pass/fail outcome with a failure tag distinguishing a confused agent from a hung one. It also carries the tags later views group by — arm, task id, tier, trial, and a timestamp.

The store appends records as immutable, timestamped samples to a per-cell location. Deepening a cell's sample size adds samples rather than overwriting any prior run, and reading a cell returns every accumulated sample.

## Acceptance criteria

- [ ] A `bench/` directory exists and is excluded from the npm package (verified by the packaging tier or an equivalent `files` check).
- [ ] The result-record shape records the four token components, turns, duration, imputed cost, outcome, failure tag, and the arm/task/tier/trial/timestamp tags.
- [ ] Appending a sample to a cell that already has samples leaves the prior samples intact; reading the cell returns all of them.
- [ ] A round-trip test writes several samples across cells and reads back exactly what was written.
