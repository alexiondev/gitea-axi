---
spec: benchmark-harness
---

## What to build

The pure scoring seam that turns a completed run into a deterministic pass/fail, plus the scoring-spec contract each task pairs with.

For a mutation task, the checker diffs the entire post-run repository state against the expected end state, so both the intended change and any collateral damage are caught. Comparison runs after normalization: volatile identifiers and timestamps are dropped, comments are matched by author and body, and labels are compared as sets. For a read task, the checker matches required facts in the agent's final report against the seeded ground truth, with no LLM judge.

This slice also defines the scoring-spec contract — a task's expected end state (for mutations) or its required answer facts (for reads) — that the checker consumes and that the runner and task suite will produce. The checker is fed synthetic state snapshots and expected states; capturing live state from a real repository is the runner's job.

## Acceptance criteria

- [x] Given synthetic actual and expected state snapshots, the full-state diff passes when they match after normalization and fails when the actual state is missing the intended change.
- [x] The diff fails when the actual state carries collateral change beyond the intended mutation.
- [x] Normalization drops volatile identifiers and timestamps, matches comments by author and body, and compares label sets order-independently.
- [x] The read-task answer-match passes when the required facts are present in the final report and fails when a required fact is missing.
- [x] The scoring-spec contract expresses both a mutation's expected end state and a read's required answer facts.

## Implementation Notes

Two new files in `bench/`: `scoring-spec.ts` (the pure contract — `RepoState` and its `Label`/`Issue`/`PullRequest`/`Review`/`Comment` shapes, `RequiredFact`, and the `ScoringSpec` discriminated union) and `checker.ts` (the logic — `checkMutation`, `checkReadAnswer`, and a `score` entry point that dispatches on task kind). This mirrors the existing `result.ts` (shape) / `store.ts` (logic) split.

Decisions and deviations worth flagging:

- **Full-state diff covers the whole PR/issue surface, including reviews, assignees, and label definitions.** The criteria name only comments and label sets under normalization, but "diffing the entire post-run repository state" (User Story 5) and the contract's need to express the scored suite's review/merge/assignee tasks (criterion 5) make these part of the contract, not scope creep. They are groundwork the runner and task suite will populate.
- **Reviews are matched order-independently**, consistent with how comments and labels are compared (spec line 9). A code review caught that reviews were initially order-dependent; this was fixed and covered by a test (`passes when a pull request's reviews match as a set despite differing order`). Review inline comments are likewise matched by author and body, order-independently.
- **Failure diagnostics (`differences` naming the affected entity/label/comment/fact)** go beyond the bare pass/fail the criteria require, so a failed trial is traceable to what diverged (User Story 14 spirit). Heavily tested.
- **Read-answer matching is deterministic substring matching** (case- and whitespace-normalized, with `anyOf` alternatives per fact), no LLM judge. This is intentionally naive — e.g. `"#42"` would match inside `"#420"` — and is mitigated by the task suite choosing disambiguating `anyOf` renderings rather than by the checker. The required facts carried in the `ScoringSpec` *are* the seeded ground truth for read tasks.
- **`score` throws on a spec/submission kind mismatch** rather than silently scoring the wrong thing; this keeps the seam deterministic and is covered by a guard test.
- No criteria were dropped; all five are satisfied.
