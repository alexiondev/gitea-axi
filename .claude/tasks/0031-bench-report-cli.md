---
spec: benchmark-harness
blocked-by: [0030-bench-aggregator-and-reporting]
---

## What to build

The maintainer-facing command that renders the accumulated sample store as the readable comparison, so the aggregator seam built in slice 0030 has a runnable entry point instead of being callable only from code.
The command opens the store, drains it, aggregates against the scored suite and bonus definitions, and prints the report — `renderReport(aggregate({ records: readAllSamples(store), suite, bonus }))` — to stdout.

It renders whatever has accumulated so far, annotating incomplete coverage rather than blocking on a complete matrix, exactly as the aggregator already does; the command adds only the argument seam and the live store/stdout boundary.
It is the reporting counterpart to `bench:run` (slice 0029): `bench/report.ts` stands over `bench/aggregate.ts` in the same shape as `bench/run.ts` stands over `bench/run-loop.ts`.

## Acceptance criteria

- [x] A `bench:report` command reads the accumulated store and prints the rendered report to stdout.
- [x] The store root defaults to `DEFAULT_STORE_ROOT` (`bench/results`) and is overridable with `--store`, matching `bench:run`.
- [x] The report is produced solely by driving the `readAllSamples` / `aggregate` / `renderReport` seam and the scored suite / bonus definitions from earlier slices — no aggregation, weighting, or rendering is reimplemented in the command.
- [x] A partial or empty store renders without error (incomplete coverage annotated, an unrun arm shown as an em dash), inheriting the aggregator's behaviour rather than special-casing it.
- [x] The argument parser is a pure, unit-tested seam (`--store`, `--help`, plus the `--self-review` / `--no-self-review` variant selector — see Implementation Notes), matching the `parseRunArgs` convention. Because the report boundary is offline, the whole command — not just the parser — is deterministic and unit-tested, rather than validated only by running it.

## Implementation Notes

- **Shape mirrors `bench/run.ts`.** `parseReportArgs` is the pure argument seam; `runReportCommand(argv, deps, out)` opens `createSampleStore(storeRoot)`, drives `renderReport(aggregate({ records: readAllSamples(store), suite, bonus }))`, and prints line-by-line through `out`; `main` and the `import.meta`/`argv[1]` direct-execution guard match `run.ts`. Added the `bench:report` script (`tsx bench/report.ts`) and replaced the flagged follow-up note in `bench/README.md` (plus a new "Reading the results" section).

- **The boundary is offline, so the whole command is unit-tested (deviation from the criterion's framing).** Criterion 5 as written assumed the run-command pattern where the live boundary is "validated by running it." But the report reads only the local sample store — no credentials, host, or Agent SDK — so `runReportCommand` is deterministic and is covered by real unit tests over a temp-dir store (populated, empty, and `--help`), not just the parser. It was still verified by running `npm run bench:report` end-to-end. The unused `deps` parameter is retained only for signature parity with the command family (commented at the parameter).

- **Added `--self-review` / `--no-self-review` — beyond the written `(--store, --help)` seam, deliberately.** `aggregate` needs a `suite` and `bonus`, and `buildScoredSuite`/`buildBonusTasks` are parameterized by `selfReviewPermitted`: when self-review is unavailable the two review tasks render as comment reviews in the scored suite and the approve/request-changes pair moves into the bonus catalog. `bench:run` resolves this by probing the live host (`detectSelfReviewSupport`); the offline report has no host to probe, so it cannot detect it and would otherwise have to hardcode one variant silently. The flag makes the choice explicit, defaulting to `true` (matching the richer self-review-permitted configuration). It is well-scoped: the scored coverage is identical either way, so it only selects the bonus capability catalog — documented in `--help` and the README. Criterion 5's "`--store`, `--help`" wording was updated to record it.

- **`DEFAULT_STORE_ROOT` moved to `store.ts`.** It was defined in `run.ts`; its natural home is the store, and both commands now need it, so it lives in `store.ts` as the single source of truth and is re-exported from `run.ts` to keep that command's existing importers (and `run.test.ts`) resolving it unchanged.

- **Tests, TDD.** `bench/report.test.ts` (8 tests) was authored test-first by the test-writer sub-agent from the public interface alone: the parser defaults/overrides/rejection/help, and the command over populated/empty/help paths. As with the `run-loop` slice, the parser is a small cohesive unit whose logic all landed in one GREEN, so the parser cases past the first are passing characterization guards rather than red-first cycles; the `runReportCommand` cell had a genuine red first. Full bench tier green (104 tests), typecheck clean.

- **Review (three-axis, `/review-uncommitted`): Risk overall Low.** Spec axis: all five criteria met; the only finding was that `--self-review` exceeded the written seam — justified in substance, now recorded here and in the criterion. Standards axis: no hard violations; two judgement calls — the `parseReportArgs` flag loop partly overlaps `parseRunArgs` but has genuinely diverged (adds `--no-` negation), left unextracted as the reviewer advised (a shared parser would be premature); and the unused `deps` parameter, addressed with a parity comment.
