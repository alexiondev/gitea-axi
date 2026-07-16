---
spec: benchmark-harness
blocked-by: [0022-bench-scaffold-and-result-store, 0023-bench-tool-isolation-guard, 0024-bench-checker-and-scoring-spec, 0025-bench-seed-provisioning, 0026-bench-arm-scaffolding]
---

## What to build

The tracer bullet that threads every layer: run a single `(arm, task, trial)` cell end-to-end and record an immutable result. This is the walking skeleton — one arm against one sample task, one trial — that proves seed, arm scaffolding, guard, runner, checker, and store all connect.

The runner provisions and seeds a fresh throwaway repository, runs the agent via the Claude Agent SDK on a single fixed model at temperature zero with exactly the active arm's tool and guard enforced, and bounds the run by a turn cap and a wall-clock backstop — exceeding either records a failure tagged to distinguish a confused agent from a hung one. It captures the four token components (including the auxiliary small model the runtime invokes, since that is real consumption), the turn count, the duration, and the imputed cost. After the run it captures the entire post-run repository state as a snapshot, scores it with the checker against the task's scoring spec, appends the result sample to the store, and deletes the throwaway repository. A post-run transcript audit asserts no foreign tool was reached; a detected leak flags the trial invalid rather than letting it be scored.

This slice also defines the runnable Task wrapper (natural-language intent, parameters, tier, and scoring spec) and includes one sample task to exercise the path; the full suite is authored in a later slice.

## Acceptance criteria

- [x] Running one cell provisions and seeds a fresh repository, runs the agent under its arm's tool with the guard active, and deletes the repository afterward.
- [x] The run is bounded by both a turn cap and a wall-clock backstop; exceeding either records a failure tagged confused-versus-hung.
- [x] The recorded sample carries the four token components (including the auxiliary small model), turns, duration, imputed cost, and the checker's pass/fail outcome.
- [x] The post-run repository state is captured as a snapshot and scored by the checker against the task's scoring spec.
- [x] A transcript audit runs after each cell; a run in which a foreign tool was reached is flagged invalid instead of scored.
- [x] A runnable Task wrapper is defined and one sample task runs the full path against the live host.

## Implementation Notes

- **Two seams for the live boundaries.** The runner's orchestration (`bench/runner.ts`, `runCell`) is unit-tested with fakes by factoring the two non-deterministic boundaries behind interfaces: `BenchHost` (provision/seed/capture/delete against live Gitea, implemented by `liveBenchHost` in `bench/host.ts` over `seed.ts` + `snapshot.ts`) and `AgentDriver` (the model run, implemented by `sdkAgentDriver` in `bench/sdk-driver.ts` over the Claude Agent SDK). This mirrors the spec's split: run orchestration is the live boundary validated by the transcript audit and the smoke run, not by unit tests.

- **Claude Agent SDK is an optional peer.** The SDK (`@anthropic-ai/claude-agent-sdk`) is loaded via a computed dynamic import, so it is not a hard dependency of the (unshipped) `bench/` harness and neither the deterministic tier nor `npm run typecheck` requires it to be installed. The runner smoke tier (`bench/runner.smoke.test.ts`) skips cleanly when the SDK is absent or `GITEA_AXI_BENCH_LOGIN` is unset — a skip counts as a pass, matching the seed smoke tier. A real run additionally needs the `gitea-axi` CLI on `PATH` and a Claude subscription. Formalizing the SDK as a declared dependency belongs to the run-loop CLI slice (0029), which is the first consumer that runs it in earnest.

- **Temperature zero.** `sdkAgentDriver` passes `temperature: 0` in the SDK query options per the runner-and-metrics spec, so the comparison measures the tool rather than sampling noise. If a given SDK version does not surface a temperature knob, the field is additive and determinism falls back to the runtime default.

- **Shared isolation predicate.** Both isolation enforcement points share one `foreignToolReason(arm, use)` in `bench/audit.ts` so they cannot drift: the driver consults it in-band to deny a foreign tool before it runs, and the runner's `auditTranscript` re-applies it post-run as the independent backstop. Only tools that were permitted to run are recorded in the transcript, so a guard-blocked attempt is realistic wasted effort, not a leak — matching the spec's tool-isolation note that "blocked attempts are left in the transcript and count as realistic wasted effort."

- **Snapshot review verbs follow Gitea.** `bench/snapshot.ts` maps review states using Gitea's `ReviewStateType` verbs (`APPROVED` / `COMMENT` / `REQUEST_CHANGES`), which Gitea returns on read as well as on the write event (unlike GitHub's `CHANGES_REQUESTED`). Inline review comments are captured as empty, matching the single-user seed's declared ground truth, which never populates them. This capture is a live boundary exercised by the smoke tier rather than mocked.

- **No criteria dropped.** All six acceptance criteria are satisfied. The sample task is a single-mutation task (close a seeded issue), chosen so the "captured as a snapshot and scored by the checker" criterion is demonstrated through the full-state diff. The "runs the full path against the live host" criterion is realized by the runner smoke tier, which skips-as-pass when no host/SDK is configured, consistent with the project's e2e and seed tiers.
