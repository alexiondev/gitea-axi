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

Later slices add the tool-isolation guard, the seed provisioning, the arm scaffolding, the single-cell runner, the task suite, the run-loop CLI, and the aggregator.

## Tests

The harness's deterministic seams are unit-tested in this directory, colocated with their source, and run via:

```
npm run test:bench
```

They are kept out of the main fast tier so harness code never counts against the `src/` coverage thresholds.
