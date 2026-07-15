---
spec: benchmark-harness
---

## What to build

The pure scoring seam that turns a completed run into a deterministic pass/fail, plus the scoring-spec contract each task pairs with.

For a mutation task, the checker diffs the entire post-run repository state against the expected end state, so both the intended change and any collateral damage are caught. Comparison runs after normalization: volatile identifiers and timestamps are dropped, comments are matched by author and body, and labels are compared as sets. For a read task, the checker matches required facts in the agent's final report against the seeded ground truth, with no LLM judge.

This slice also defines the scoring-spec contract — a task's expected end state (for mutations) or its required answer facts (for reads) — that the checker consumes and that the runner and task suite will produce. The checker is fed synthetic state snapshots and expected states; capturing live state from a real repository is the runner's job.

## Acceptance criteria

- [ ] Given synthetic actual and expected state snapshots, the full-state diff passes when they match after normalization and fails when the actual state is missing the intended change.
- [ ] The diff fails when the actual state carries collateral change beyond the intended mutation.
- [ ] Normalization drops volatile identifiers and timestamps, matches comments by author and body, and compares label sets order-independently.
- [ ] The read-task answer-match passes when the required facts are present in the final report and fails when a required fact is missing.
- [ ] The scoring-spec contract expresses both a mutation's expected end state and a read's required answer facts.
