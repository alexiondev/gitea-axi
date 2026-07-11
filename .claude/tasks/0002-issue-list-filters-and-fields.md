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

- [ ] `--label`, `--assignee`, `--author`, and `--milestone` map to their Gitea API query params and filter server-side
- [ ] `--sort <created|updated|comments>` reorders descending client-side after full pagination; the count line still reports `T` from `X-Total-Count`
- [ ] `--fields` selects among the documented extra fields, each rendered via its FieldDef extractor (relative times, joined label names, milestone title)
- [ ] Output contains no `type` field
- [ ] `--search` fails with `VALIDATION_ERROR` (exit 2) and a help line pointing at `gitea-axi search issues "<query>"`
- [ ] Fixture-server tests cover each filter, client-side sort with pagination, `--fields` extraction, and the forbidden `--search`
