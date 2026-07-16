# Benchmark harness

This directory holds the benchmark harness that measures gitea-axi's central claim — that it is an agent-ergonomic, low-token interface to Gitea — against the `tea` CLI, the official `gitea-mcp` server, and raw Gitea REST calls.

It is **not part of the published npm package**.
The package's `files` allow-list ships only `dist` and `skills`; `bench/` is excluded, and the packaging tier asserts it stays out of the tarball.

The design lives in [`.claude/spec/benchmark-harness.md`](../.claude/spec/benchmark-harness.md) and the `.claude/adr/0014`–`0016` decision records.
This README is the harness's own working documentation; it deliberately keeps the benchmark's vocabulary here rather than in the tool's domain glossary ([`.claude/CONTEXT.md`](../.claude/CONTEXT.md)), which describes gitea-axi's own language.

## Vocabulary

**arm** — one of the four tool conditions under comparison: `gitea-axi`, `tea`, `gitea-mcp`, `raw-api`.
The comparison measures the tool, so the agent in each arm is given exactly one arm's tool.

**cell** — one `(arm, task)` pair.
A cell's trials accumulate as samples within it; deepening a cell's sample size adds samples rather than overwriting prior runs.

**trial** — one run of a cell.
Each cell defaults to five trials with a reporting floor of three.

**tier** — the task category a task belongs to: `read`, `single-mutation`, `find-then-act`, `multi-step`.
Views group by tier to show where an arm wins or loses.

**cost-equivalent tokens** — the headline metric: the four token components weighted by Anthropic's published API pricing ratios (see ADR 0014).
The raw component breakdown is retained on every sample so the data can be re-weighted without re-running.

**seed** — the deterministic, idempotent starting state scripted into each throwaway repository before a trial, against which correctness is scored.

**checker** — the deterministic scorer that diffs post-run repository state (mutation tasks) or matches required facts in the agent's report (read tasks) against the seeded ground truth.

## Layout

- `result.ts` — the immutable result-record shape and its tags (arm, task, tier, trial, timestamp).
- `store.ts` — the append-only, per-cell sample store that accumulates result records.
- `guard.ts` — the authoritative tool-isolation guard plus the curated per-arm bin directory that backs it.
- `scoring-spec.ts` — the scoring-spec contract: a task's expected end state (mutation) or required answer facts (read), consumed by the checker and produced by the runner and task suite.
- `checker.ts` — the deterministic scorer: the full-state diff for mutation tasks and the answer-match for read tasks, plus the `score` entry point that dispatches on task kind.
- `seed-plan.ts` — the deterministic ground truth every throwaway repository is seeded to: the fixed labels, the open/closed issue spread across the discriminating dimensions, and the pull requests, as pure data plus `groundTruth(user)`, which realizes it into the `RepoState` the checker scores against.
- `seed.ts` — the idempotent seeding scripted over the live Gitea API: `resolveBenchAccess` (which reuses gitea-axi's own tea-login credential discovery), `provisionRepo`, and `seedRepo`, reconciling each label, issue, pull request, comment, and review by its natural key so a re-run never duplicates the ground truth.
- `arm.ts` — the per-arm scaffolding: `basePrompt` (the identical task-agnostic base every arm shares) and `buildArm`, which produces the single `ArmDefinition` the runner consumes — the assembled prompt plus the tool configuration. The gitea-axi arm embeds the bundled Agent Skill, the tea and raw-api arms get a one-line native-discovery pointer, and the gitea-mcp arm runs with the shell disabled and only the MCP server attached (its dispatcher schemas load eagerly). The shell arms' PATH and guard come from `guard.ts`.
- `task.ts` — the runnable `BenchTask` wrapper (natural-language intent, tier, and a scoring spec keyed on the single available user) plus one `SAMPLE_TASK` that exercises the full path.
- `task-suite.ts` — the full scored suite and the bonus definitions. `buildScoredSuite` returns the 20 shared-surface tasks (weighted four read / six single-mutation / six find-then-act / four multi-step), each phrased as a natural-language intent parametrized against the seed and carrying a tier and a scoring spec; its two review tasks are approve/request-changes or comment reviews depending on the self-review flag. `buildBonusTasks` returns the capability-asymmetric operations kept out of the scored suite, in both directions — gitea-axi's edges where the other arms fall short (full-text search, diff, checks, checkout, issue dependencies) and the repository/release/milestone operations for which gitea-axi is reported not-applicable — plus the approve/request-changes pair when self-review is unavailable.
- `self-review.ts` — `probeSelfReview` and `detectSelfReviewSupport`, the capability probe that determines whether the host permits a user to approve or request changes on their own pull request, so the suite builder can promote the two review tasks or leave them as comment reviews. A live boundary, so it is exercised by the smoke run rather than mocked.
- `snapshot.ts` — `captureRepoState`, the seed's counterpart: it reads the whole scored surface of a live repository back into the `RepoState` the checker diffs against, normalizing the few fields whose live form differs from the ground truth (notably label colours). A live boundary, so it is exercised by the smoke run rather than mocked.
- `audit.ts` — `auditTranscript`, the post-run isolation audit: it re-runs the arm's own guard over the executed shell commands and checks channel discipline (a shell arm never reaches MCP tools; the MCP arm never reaches the shell), returning the leaks that flag a trial invalid rather than scored.
- `runner.ts` — the single-cell runner: `runCell` threads every layer to run one `(arm, task, trial)` cell end to end — provision, seed, run the agent bounded by a turn cap and a wall-clock backstop, audit the transcript, capture and score the post-run state, append the sample, and delete the repository. The live host and the Agent SDK are factored behind the `BenchHost` and `AgentDriver` seams, so the orchestration is unit-tested with fakes while the live wiring is validated by the smoke run.
- `host.ts` — `liveBenchHost`, the production `BenchHost`: a thin composition of `seed.ts` (provision, seed, delete) and `snapshot.ts` (capture) bound to one set of host credentials.
- `sdk-driver.ts` — `sdkAgentDriver`, the production `AgentDriver`: it runs one arm through the Claude Agent SDK on the maintainer's subscription, enforcing isolation in-band via the SDK's permission callback (the arm's guard on every Bash command; the shell disabled on the MCP arm) and reporting the four token components (folding in the auxiliary small model), the turn count, the imputed cost, the transcript, and the final report. The SDK is loaded through a computed dynamic import so it is an optional peer needed only for live runs.

Later slices add the run-loop CLI and the aggregator.

## Tests

The harness's deterministic seams are unit-tested in this directory, colocated with their source, and run via:

```
npm run test:bench
```

They are kept out of the main fast tier so harness code never counts against the `src/` coverage thresholds.

Seed provisioning and single-cell run orchestration are the two boundaries validated live rather than by mocks, since their value is the real Gitea API interaction and the real model run.
The smoke tier talks to a real host — the maintainer's own, discovered through the tea-login credential path — and skips cleanly when no host is configured:

```
GITEA_AXI_BENCH_LOGIN=<tea-login-name> npm run test:bench:smoke
```

With `GITEA_AXI_BENCH_LOGIN` unset the smoke tier skips (a pass), matching the end-to-end tier's behavior when no live instance is configured.
The runner smoke additionally requires the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, an optional peer of the harness, needed only for live runs) and the `gitea-axi` CLI on `PATH`; it skips when the SDK is not installed and needs a Claude subscription to run for real.
The post-run transcript audit is what validates run orchestration: a run in which a foreign tool was reached is flagged invalid rather than scored.
The self-review probe is the third live boundary: its smoke run provisions and seeds a throwaway repository, attempts an approval on the user's own pull request, and asserts the probe reaches a definite verdict — whichever way the host is configured.
