---
spec: benchmark-harness
blocked-by: [0027-bench-single-cell-runner, 0028-bench-task-suite]
---

## What to build

The maintainer-facing command that runs a chosen benchmark cell on demand, so only the token budget available at that moment is spent. The maintainer selects an arm and a task; the command runs that cell and accumulates results.

Each cell defaults to five trials with a reporting floor of three. Because results are immutable timestamped samples, running a cell that already has samples deepens it — the new trials append rather than overwrite, so a cell's sample size can be grown opportunistically across separate sittings.

## Acceptance criteria

- [ ] The command runs a single selected `(arm, task)` cell on demand.
- [ ] A cell defaults to five trials, and the reporting floor of three is respected.
- [ ] Re-running an already-sampled cell appends new trials rather than overwriting prior samples.
- [ ] The command drives the runner and store built in earlier slices rather than reimplementing orchestration.
