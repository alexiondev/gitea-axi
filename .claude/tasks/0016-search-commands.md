---
spec: gitea-axi
blocked-by: 0008-pr-list
---

## What to build

The full-text escape hatch: `search issues <query>` and `search prs <query>`, the destination of the forbidden `--search` redirects.
Both hit Gitea's repo-issues search endpoint with the query, a `type` of issues or pulls, and the owner param; since the endpoint has no repo-name filter, results are filtered client-side to the current repository via each result's repository field, following the client-side filtering policy including its count-line rule.
The positional query is required (`VALIDATION_ERROR` if missing).
Flags: `--state` (default open), `--label` (comma-separated names, API-supported), `--limit` (default 30), `--fields`.
Both commands use the locator schema (`number`, `title`, `state`, `author`, `created`) — search finds the number, `issue view`/`pr view` load the detail — and output blocks `issues:`/`pull_requests:` matching the list commands.

## Acceptance criteria

- [x] `search issues "<query>"` and `search prs "<query>"` query the search endpoint with the right `type` and owner, then filter to the current repo client-side
- [x] The count line reports `count: N of T total` with `T` from the client-side-filtered set
- [x] A missing query yields `VALIDATION_ERROR` (exit 2)
- [x] `--state`, `--label`, `--limit`, and `--fields` work; default fields are the locator schema
- [x] Empty results emit the standard `<noun>[0]: (none)` empty state
- [x] Fixture-server tests cover both types, cross-repo results being filtered out, and the missing-query validation
- [x] End-to-end tests run `search issues` and `search prs` against a live Gitea instance and assert real matches are returned with the locator schema, confirming the live search-endpoint response shape and the `type`/`owner`/`q` query behavior the fixture server cannot attest to

## Implementation Notes

- Both variants live in one `src/commands/search.ts`, parameterised by a `SearchKind` config (`type`, output `noun`, the `view` command a match feeds into, and `--help` text) — the same config-object dispatch used elsewhere (`pr.ts`'s `DependencyGroup`).
  `search issues` and `search prs` share the endpoint call, the client-side repo filter, and the render, differing only in that config.
- The repo filter is *always* client-side (the endpoint has no repo-name param), so every call fully paginates via `fetchAllPages` and then filters to the current repo by matching each result's `repository.owner`/`repository.name` case-insensitively.
  The count-line total `T` is the filtered set's own size, so the endpoint's cross-repo `X-Total-Count` is never used — the ADR 0005 client-side-filtering rule.
- `--limit` caps the shown rows *after* filtering while `T` keeps the full filtered total, matching `pr list`'s client-filter behaviour.
- `--label` is passed straight through as the endpoint's `labels` param (comma-separated names): the search endpoint takes names directly, so there is no name→id lookup, unlike `pr list --label`.
- The `--fields` extra-field vocabulary (`body`, `closedAt`, `labels`, `milestone`, `updatedAt`, `url`) mirrors `issue list`'s, since search results are Issue-shaped for both types.
- Added, beyond the bare acceptance criteria, ordinary CLI hygiene consistent with the sibling commands: a `search` group help, per-variant `--help` text, an unknown-subcommand `VALIDATION_ERROR`, a too-many-positionals rejection, and top-level-help entries in `cli.ts`.
