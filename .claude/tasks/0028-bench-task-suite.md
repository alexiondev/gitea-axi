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

- [ ] The scored suite has 20 tasks confined to the shared capability surface, phrased as natural-language intents parametrized against the seed.
- [ ] The suite is weighted roughly four read / six single-mutation / six find-then-act / four multi-step, with each task carrying a tier tag and a scoring spec.
- [ ] A self-review capability probe determines whether the two review tasks run as approve/request-changes or as comment reviews (falling back to the bonus table if self-review is not permitted).
- [ ] Bonus task definitions cover the asymmetries in both directions, including the gitea-axi not-applicable operations, and are kept separate from the scored suite.
