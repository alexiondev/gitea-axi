---
spec: benchmark-harness
blocked-by: [0022-bench-scaffold-and-result-store, 0023-bench-tool-isolation-guard, 0024-bench-checker-and-scoring-spec, 0025-bench-seed-provisioning, 0026-bench-arm-scaffolding]
---

## What to build

The tracer bullet that threads every layer: run a single `(arm, task, trial)` cell end-to-end and record an immutable result. This is the walking skeleton — one arm against one sample task, one trial — that proves seed, arm scaffolding, guard, runner, checker, and store all connect.

The runner provisions and seeds a fresh throwaway repository, runs the agent via the Claude Agent SDK on a single fixed model at temperature zero with exactly the active arm's tool and guard enforced, and bounds the run by a turn cap and a wall-clock backstop — exceeding either records a failure tagged to distinguish a confused agent from a hung one. It captures the four token components (including the auxiliary small model the runtime invokes, since that is real consumption), the turn count, the duration, and the imputed cost. After the run it captures the entire post-run repository state as a snapshot, scores it with the checker against the task's scoring spec, appends the result sample to the store, and deletes the throwaway repository. A post-run transcript audit asserts no foreign tool was reached; a detected leak flags the trial invalid rather than letting it be scored.

This slice also defines the runnable Task wrapper (natural-language intent, parameters, tier, and scoring spec) and includes one sample task to exercise the path; the full suite is authored in a later slice.

## Acceptance criteria

- [ ] Running one cell provisions and seeds a fresh repository, runs the agent under its arm's tool with the guard active, and deletes the repository afterward.
- [ ] The run is bounded by both a turn cap and a wall-clock backstop; exceeding either records a failure tagged confused-versus-hung.
- [ ] The recorded sample carries the four token components (including the auxiliary small model), turns, duration, imputed cost, and the checker's pass/fail outcome.
- [ ] The post-run repository state is captured as a snapshot and scored by the checker against the task's scoring spec.
- [ ] A transcript audit runs after each cell; a run in which a foreign tool was reached is flagged invalid instead of scored.
- [ ] A runnable Task wrapper is defined and one sample task runs the full path against the live host.
