# Single-user seed and its constraints on the task surface

The benchmark seeds a throwaway repository to a known state before each trial and scores tasks against that ground truth.
Seeding realistic author and assignee variety would require several Gitea accounts.
The maintainer prefers to run the benchmark under their single existing account rather than provision additional accounts.

## Considered Options

**Provision throwaway collaborator accounts** (rejected) — Multiple accounts would restore the author and assignee dimensions and enable non-self pull-request approvals, but they add account lifecycle and credential handling that the maintainer explicitly declined for this benchmark.

**Keep multi-user tasks and let arms fail** (rejected) — Retaining tasks that need distinct authors or a non-self reviewer would make those tasks impossible under one account for every arm uniformly, producing no comparative signal while consuming budget.

**Single-user seed with a redesigned surface** (chosen) — All seed content is authored by the one account, and the discriminating dimensions become label, state, assignee presence (assigned-to-self versus unassigned), and title keyword instead of author.
Tasks that assumed author or assignee variety are recast onto these axes: reassignment becomes assign-to-self or unassign, and author-filtered bulk mutation becomes a filter on assignee presence.

## Consequences

- Author filtering leaves the scored suite; it carries little signal with one author anyway.
- Review tasks in the scored suite use comment-type reviews, which a user may leave on their own pull request.
  Whether the host permits self-approval and self-request-changes is verified during implementation; if permitted, those two tasks are promoted from comment reviews to approve and request-changes, otherwise approve and request-changes move to the bonus table as two-account scenarios.
- Non-self approval, distinct-author filtering, and distinct-assignee tasks are out of scope for the scored suite and belong to the multi-account bonus scenarios.
- The seed stays small and fully deterministic, which keeps the full-state diff used for collateral-damage checking cheap to compute and reason about.
