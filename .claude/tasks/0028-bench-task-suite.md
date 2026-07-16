---
spec: benchmark-harness
blocked-by: [0024-bench-checker-and-scoring-spec, 0025-bench-seed-provisioning, 0027-bench-single-cell-runner]
---

## What to build

The full scored task suite plus the capability-asymmetric bonus definitions, authored against the runnable Task wrapper and scored against the seed's ground truth.

The scored suite is 20 tasks drawn only from the capability surface shared by all four arms — issue and pull-request listing, viewing, creation, editing, closing and reopening, commenting and comment retrieval, label management and application, review comments, merge, and assignee changes. Tasks are phrased as natural-language intents, not command invocations, parametrized against the seed, each carrying its tier tag and scoring spec. The suite is weighted toward discovery and multi-step work: roughly four read tasks, six single-mutation tasks, six find-then-act tasks, and four multi-step workflows.

Review tasks default to comment-type reviews, which a single user can leave on their own pull request. Whether the host permits a user to approve or request changes on their own pull request is probed during implementation; if permitted, the two review tasks are promoted from comment reviews to approve and request-changes, otherwise those move to the bonus table.

The bonus definitions cover capability-asymmetric operations in both directions: where tea, gitea-mcp, or raw API fall short of gitea-axi (full-text search, diff, checks, checkout, issue dependencies), and operations outside gitea-axi's scope (repository, release, and milestone management), for which gitea-axi is reported not-applicable. These are kept out of the scored suite.

## Acceptance criteria

- [x] The scored suite has 20 tasks confined to the shared capability surface, phrased as natural-language intents parametrized against the seed.
- [x] The suite is weighted roughly four read / six single-mutation / six find-then-act / four multi-step, with each task carrying a tier tag and a scoring spec.
- [x] A self-review capability probe determines whether the two review tasks run as approve/request-changes or as comment reviews (falling back to the bonus table if self-review is not permitted).
- [x] Bonus task definitions cover the asymmetries in both directions, including the gitea-axi not-applicable operations, and are kept separate from the scored suite.

## Implementation Notes

The suite and bonus definitions live in `bench/task-suite.ts`; the self-review probe lives in `bench/self-review.ts`.

**Self-review probe as a runtime seam, not a baked-in constant.**
The task says self-review support is "probed during implementation." Rather than probing the host once and hard-coding a boolean, this splits the concern the way the rest of the harness is factored: `buildScoredSuite({ selfReviewPermitted })` and `buildBonusTasks({ selfReviewPermitted })` are pure functions unit-tested against a flag, and `self-review.ts` (`probeSelfReview` / `detectSelfReviewSupport`) is the live boundary that resolves the flag once per sweep — provision a throwaway repo, seed it, attempt an approval on the user's own pull request, delete the repo, report the verdict. This matches the seed/snapshot pattern (live boundaries are smoke-validated, not mocked) and means the suite tracks whatever the host actually permits instead of a guess frozen at authoring time. Wiring the probe into a full sweep belongs to the later run-loop-CLI slice; this slice ships the probe and the flag-driven builders.

**Review tasks placed in the find-then-act tier.**
The two review tasks (`fta-review-csv-pull`, `fta-review-docs-pull`) are find-then-act rather than single-mutation: each names its target pull request by a property (implements CSV export / refreshes documentation) and forces discovery before acting, which is the tier's defining trait. Their `kind` (and the intent's verb) toggles on `selfReviewPermitted`: approved/request-changes when permitted, comment otherwise; when not permitted the approve/request-changes operations are emitted as `self-review-unavailable` bonus entries instead.

**`bench/seed.ts` change.**
`request` (the non-throwing round-trip) is now exported so the probe can read a 4xx (a host forbidding self-approval) as `false` without it being thrown, while a network-level failure still propagates. This is the only edit outside the new files.

**Label creation in a multi-step task.**
`ms-create-and-apply-stale` creates a new label, which reads "label management" (shared-surface item) at its most generous. It is deliberately kept a scored task rather than a bonus one, since label creation is within every arm's reach.

All 20 mutation/read specs were cross-checked against the `SEED_PLAN` ground truth (target titles exist, pre-states and encoded changes match the intents) during the spec-fidelity review. No acceptance criteria were dropped.
