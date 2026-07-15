---
spec: benchmark-harness
---

## What to build

The foundation the whole benchmark harness reads and writes: a `bench/` directory (excluded from the published npm package, alongside the existing `dist`/`skills` allow-list), the immutable result-record shape, and an append-only per-cell sample store.

A result record captures one completed `(arm, task, trial)` run: the four token components (fresh input, cache-creation, cache-read, output), the turn count, the wall-clock duration, the imputed cost, and the pass/fail outcome with a failure tag distinguishing a confused agent from a hung one. It also carries the tags later views group by — arm, task id, tier, trial, and a timestamp.

The store appends records as immutable, timestamped samples to a per-cell location. Deepening a cell's sample size adds samples rather than overwriting any prior run, and reading a cell returns every accumulated sample.

## Acceptance criteria

- [x] A `bench/` directory exists and is excluded from the npm package (verified by the packaging tier or an equivalent `files` check).
- [x] The result-record shape records the four token components, turns, duration, imputed cost, outcome, failure tag, and the arm/task/tier/trial/timestamp tags.
- [x] Appending a sample to a cell that already has samples leaves the prior samples intact; reading the cell returns all of them.
- [x] A round-trip test writes several samples across cells and reads back exactly what was written.

## Implementation Notes

- The harness lives in `bench/`, kept out of the published package by the existing `files` allow-list (`["dist", "skills"]`); a new assertion in the packaging tier (`test/packaging/packaging.test.ts`) locks in that `package/bench` never ships.
- `bench/result.ts` holds the immutable `ResultRecord` shape. `Arm` and `Tier` are typed unions (the four arms; the four task tiers from the spec) rather than bare strings, and the failure tag is `"incorrect" | "confused" | "hung"` — the spec/task only required distinguishing confused (turn cap) from hung (wall-clock backstop), and `incorrect` is added for the ordinary checker-scored-wrong failure the later runner will record.
- `bench/store.ts` is the append-only sample store, backed by one newline-delimited JSON file per cell at `<root>/<arm>/<taskId>.jsonl`. Immutability is structural: the store exposes only `append`/`read`/`cells`, and append is a bare file append, so deepening a cell can only add lines. `cells()` enumerates written cells — slightly beyond the literal criteria but foundational for the aggregator slice (0030), which reads the store.
- Bench tests run in a dedicated tier (`vitest.bench.config.ts`, `npm run test:bench`), colocated with the source, kept out of the fast tier so harness code never counts against the `src/` coverage thresholds. `tsconfig.json` now includes `bench` so the harness is typechecked.
- Benchmark vocabulary (arm, cell, tier, cost-equivalent tokens, seed, checker) is documented in `bench/README.md`, deliberately kept out of the tool's domain glossary (`.claude/CONTEXT.md`) per the spec's Further Notes.
- Review: Risk overall Low; Spec axis clean; two Standards judgement-call Duplicated Code findings addressed in the refactor — `append` now routes through `cellPath`, and the repeated ENOENT handling is factored into one `ignoreEnoent` helper.
