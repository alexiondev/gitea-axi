# Client-side filtering when the Gitea API lacks a filter parameter

When a `--filter` flag has no corresponding query parameter in Gitea's API (e.g. `pr list --assignee`), gitea-axi paginates through all results and filters in-process.

## Considered Options

**Drop the flag** (rejected) — Maintaining interface parity with gh-axi is an explicit goal.
Dropping flags that gh-axi supports degrades usability and breaks agent prompts written for the gh-axi interface.

**Emit NOT_SUPPORTED error** (rejected) — Surfacing a capability gap as a runtime error is unhelpful; the agent asked for a filtered list and received nothing.

**Client-side filtering** (chosen) — Paginate all results (`limit=50` per page until exhausted), filter in-process, return the matching set.
This produces correct results at the cost of extra HTTP calls.
The spec explicitly calls out that API call cost on the gitea-axi side does not factor into design decisions.

## Consequences

- All unsupported filter flags still appear in the CLI surface with identical semantics to gh-axi.
- The count line emits `count: N of T total` with `T` computed from the in-memory filtered set when any client-side filter is active; the `X-Total-Count` header (which reflects the unfiltered total) is ignored as misleading.
  Since client-side filtering paginates everything anyway, the true filtered total is always known — reporting it satisfies canonical Principle 4 ("always report total item count").
  (Amended 2026-07-10: this originally specified a bare `count: N`, which under-reported a total the tool had already computed.)
- Client-side *sort* (`issue list --sort`) is not a filter: it reorders without changing membership, so the unfiltered total remains accurate and `T` comes from the `X-Total-Count` header as usual.
  Sorting still requires full pagination before ordering, like filtering.
- Full pagination is bounded by the instance's total issue/PR count, which is acceptable for single-repo agent workflows.
