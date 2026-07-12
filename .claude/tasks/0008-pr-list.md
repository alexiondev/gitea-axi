---
spec: gitea-axi
blocked-by: 0004-issue-create-and-comment
---

## What to build

`pr list`, introducing two policies that later slices reuse: client-side filtering with its count-line rule (see ADR 0005) and the reviewDecision computation via parallel review fetches (see ADR 0006).
API-supported flags: `--state`, `--author` (maps to `poster`), `--label` (name→ID via the case-insensitive label lookup, since the PR list endpoint takes label IDs), `--label-id` (Gitea-specific bypass), `--sort` (Gitea-specific values passed straight to the API), `--limit`, `--fields`.
Client-side filters (no API param exists): `--assignee`, `--base`, `--head`, `--draft` — each paginates fully at 50 per page and filters in-process, with the count line's `T` computed from the filtered set instead of the misleading `X-Total-Count`.
Default fields: `number`, `title`, `state`, `author`, `draft` (bool→yes/no), `review` — the reviewDecision mapped to `approved`/`changes_requested`/`required`.
reviewDecision uses the official-first fallback: only official reviews count when any exist, otherwise all reviews; `CHANGES_REQUESTED` beats `APPROVED`, non-stale non-dismissed approval wins, everything else is `required`; there is no `none` value.
`--search` is forbidden with a redirect to `search prs`.

## Acceptance criteria

- [x] `pr list` renders the default fields with `review` computed from one parallel review fetch per PR
- [x] reviewDecision honors the official-first fallback and maps to the three lowercase values, with zero-review and comment-only PRs rendering `required`
- [x] `--label` resolves the name case-insensitively to an ID (`VALIDATION_ERROR` if unknown); `--label-id` bypasses the lookup
- [x] `--author` and `--sort` map to their API params; `--sort` accepts the six Gitea values
- [x] `--assignee`, `--base`, `--head`, and `--draft` filter client-side after full pagination, and the count line reports `count: N of T total` with `T` from the in-memory filtered set
- [x] `--fields` exposes `body`, `createdAt`, `labels`, `milestone`, `mergedAt`, `url`
- [x] `--search` fails with `VALIDATION_ERROR` (exit 2) pointing at `gitea-axi search prs "<query>"`
- [x] Empty result emits `pull_requests[0]: (none)` plus a suggestion
- [x] Fixture-server tests cover the review computation variants (official/unofficial, stale, dismissed), each client-side filter with its count line, the label lookup, and the forbidden flag

## Implementation Notes

- The `reviewDecision` computation lives in a new `src/review.ts` module (`reviewDecision` pure core + `fetchReviewDecision` I/O shell), so `pr view` and the dashboard can reuse the same policy in later slices (ADR 0006).
- Added a `boolText` field extractor to `src/fields.ts` for the `draft` bool→yes/no column; it is part of the shared field vocabulary rather than inlined, since `pr view` renders `draft` too.
- Extracted `parsePositiveInt` into `src/flags.ts` and routed `pr list`'s `--limit`/`--label-id` and `issue list`'s `--limit` through it, collapsing three copies of the same positive-integer parse into one (a review finding). Behaviour and error wording are unchanged.
- Small unrequested robustness kept deliberately: `--label-id` accepts a comma-separated list (mirroring `--label`), and `--label` + `--label-id` may be combined — their resolved IDs concatenate. The spec describes each as a single value; this is a strict superset with no behaviour change for the single-value case.
- The `url` extra field plucks `html_url` (the browsable URL), matching `issue list`'s precedent rather than Gitea's API `url` field.
