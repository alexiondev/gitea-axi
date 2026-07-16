---
spec: benchmark-harness
blocked-by: [0027-bench-single-cell-runner, 0028-bench-task-suite]
---

## What to build

The maintainer-facing command that runs a chosen benchmark cell on demand, so only the token budget available at that moment is spent. The maintainer selects an arm and a task; the command runs that cell and accumulates results.

Each cell defaults to five trials with a reporting floor of three. Because results are immutable timestamped samples, running a cell that already has samples deepens it — the new trials append rather than overwrite, so a cell's sample size can be grown opportunistically across separate sittings.

## Acceptance criteria

- [x] The command runs a single selected `(arm, task)` cell on demand.
- [x] A cell defaults to five trials, and the reporting floor of three is respected.
- [x] Re-running an already-sampled cell appends new trials rather than overwriting prior samples.
- [x] The command drives the runner and store built in earlier slices rather than reimplementing orchestration.

## Implementation Notes

**Two seams, matching the harness's established split.**
The pure orchestration is `runCells` in `bench/run-loop.ts`: it decides only how many trials to run and at what trial numbers, then delegates provision/run/score/append to `runCell` and the sample store — it reimplements no orchestration (criterion 4).
The maintainer command is `bench/run.ts`: `parseRunArgs` is the pure, unit-tested argument seam, and `runBenchCommand`/`main` are the live boundary (resolve credentials, probe self-review, select the task, drive `runCells`).
Following `bench/README.md`'s convention, the live boundary is validated by running it rather than by mocked unit tests — and, deliberately, by reusing pieces already smoke-covered (`runCell` via the runner smoke, `detectSelfReviewSupport` via the self-review smoke, `liveBenchHost` via the seed smoke) rather than adding a new smoke test that would spend real tokens on every invocation.

**Deepening by highest trial number, not sample count.**
`runCells` continues numbering from `max(existing trial) + 1`, not from the sample count, so an earlier invalid attempt (which records no sample and leaves a gap) can never cause a later sitting to reuse a trial number.

**TDD sequencing deviation.**
The run loop is a small cohesive unit, so its first GREEN already carried the trial-numbering and floor logic; tests 2 and 3 (deepening, invalid/floor) and the parser override/reject/help tests are therefore passing characterization/regression tests rather than red-first cycles.
Each was still written test-first by the test-writer sub-agent, from the public interface only, with independent expected literals — they remain discriminating guards.

**Running the harness's TypeScript.**
Node's native type stripping does not rewrite `.js` import specifiers to `.ts`, which the whole `bench/` tree relies on, so the command runs under `tsx` (added as a devDependency) via `npm run bench:run`.
The Claude Agent SDK is now formally declared — as an *optional* `peerDependency` (`@anthropic-ai/claude-agent-sdk`) — so it is documented but neither installed for package consumers nor pulled into CI's `npm ci`; the maintainer installs it for live runs, matching how the driver already treats it as an optional peer.
The default store root `bench/results/` is gitignored.

**Review finding addressed — `--model` dropped.**
The spec fixes a single model across all arms so the comparison measures the tool, not the model.
A per-cell `--model` override (flagged as scope creep by the spec-fidelity review) would let arms drift onto different models, so it was removed.
`--turn-cap` and `--wall-clock-ms` were kept: they are safe-defaulted bounds a maintainer may legitimately need to raise for a heavier task, and they do not affect cross-arm comparability.

**Deferred to the aggregator (slice 0030).**
The CLI tally reports recorded/invalid counts and reporting-floor status, but does not break failures out by tag (incorrect/confused/hung); those tags are on every stored sample and are the reporting slice's job to surface.
