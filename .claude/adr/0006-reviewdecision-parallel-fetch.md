# Compute reviewDecision client-side via parallel review fetches on pr list

Gitea has no aggregated `reviewDecision` field (neither REST nor GraphQL).
gitea-axi computes it client-side from the reviews list and includes it as a default field on `pr list` and `pr view`, matching gh-axi's interface.

## Decision

For `pr list`, fetch the reviews list for each PR in parallel (one HTTP call per PR) alongside the main list call.
Derive `reviewDecision` using: `APPROVED` if at least one review has `official=true`, `stale=false`, `dismissed=false` and no non-dismissed `REQUEST_CHANGES` exists; `CHANGES_REQUESTED` if any such `REQUEST_CHANGES` exists; `REVIEW_REQUIRED` otherwise.

## Considered Options

**Omit reviewDecision from default fields** (rejected) — The field is in gh-axi's default schema for `pr list`.
Dropping it breaks interface parity and forces agents to issue explicit follow-up calls.

**Include as opt-in `--fields` only** (rejected) — Same problem: agents trained on gh-axi expect it by default.

**Parallel fetch per PR** (chosen) — One extra HTTP call per PR in the list, all issued in parallel.
Accepted explicitly: API call cost does not factor into design decisions for this project.

## Consequences

- `pr list` with N results makes N+1 HTTP calls (list + N review fetches).
- `official` and `stale` fields are exposed on `pr view --reviews` as Gitea-specific bonus data.
- The `reviewDecision` field appears in the default schema for both `pr list` and `pr view`.
