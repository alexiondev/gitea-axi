---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

Complete the `issue list` flag surface on top of the minimal version from the tracer slice.
API-supported filters: `--label` (comma-separated names, passed through), `--assignee` (maps to `assigned_by`), `--author` (maps to `created_by`), `--milestone` (maps to `milestones`).
Client-side sort: `--sort <created|updated|comments>`, always descending, paginating fully before sorting while keeping the count line's `T` from the `X-Total-Count` header (sort reorders without changing membership).
Field selection: `--fields <a,b,c>` exposing the extra fields `body` (raw), `closedAt`, `labels` (joined names), `milestone` (title), `updatedAt`, `url`, built on the FieldDef extractor system.
`--search` is explicitly forbidden with a `VALIDATION_ERROR` redirecting to `search issues`.

## Acceptance criteria

- [x] `--label`, `--assignee`, `--author`, and `--milestone` map to their Gitea API query params and filter server-side
- [x] `--sort <created|updated|comments>` reorders descending client-side after full pagination; the count line still reports `T` from `X-Total-Count`
- [x] `--fields` selects among the documented extra fields, each rendered via its FieldDef extractor (relative times, joined label names, milestone title)
- [x] Output contains no `type` field
- [x] `--search` fails with `VALIDATION_ERROR` (exit 2) and a help line pointing at `gitea-axi search issues "<query>"`
- [x] Fixture-server tests cover each filter, client-side sort with pagination, `--fields` extraction, and the forbidden `--search`

## Implementation Notes

Exhaustive pagination landed as a shared `src/paginate.ts` (`fetchAllPages`, `readTotalCount`), since ADR 0005 makes it a policy that later slices (`pr list`, the dashboard) reuse rather than a detail of this command.
`lookup.ts`'s `listAllLabels` hand-rolled the same loop and now calls the shared helper, which removed its local `LABEL_PAGE_SIZE`/`LABEL_PAGE_LIMIT` constants.
The helper carries the 20-page cap those constants encoded, matching the 1000-item ceiling Principle 8 sets on exhaustive pagination — without it a server that ignores paging would loop forever.

Two count-line details the acceptance criteria did not spell out.
Under `--sort`, `--limit` caps the *sorted* result rather than the fetch, so pages are always read at the full page size of 50 and the top `N` by the sort key is what the limit selects.
Also under `--sort`, when an instance omits `X-Total-Count`, the total falls back to the size of the fully paginated set instead of degrading to `count: N (showing first N)` — everything was fetched to sort it, so the total is known, and Principle 4 says a total is always reported.

`--sort` and `--state` shared an enum-parsing shape, now extracted as `parseEnumFlag` in `flags.ts`.

**Open question for the spec, deliberately not resolved here:** `--fields body` renders the body raw and untruncated, exactly as this task and the spec's command surface specify ("`body` (raw)"), matching the already-merged `issue create --fields body`.
This contradicts Principle 3 ("Body text is truncated at **500 characters** in all contexts (list and detail alike)"): a 30-row list with `--fields body` can now emit 30 full bodies, which is the cost Principle 3 exists to prevent.
Truncating here alone would make `issue list` disagree with `issue create`, so the conflict wants one ruling applied to both commands rather than a silent divergence in this slice.
