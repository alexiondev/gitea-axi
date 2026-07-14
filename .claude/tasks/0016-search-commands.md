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

- [ ] `search issues "<query>"` and `search prs "<query>"` query the search endpoint with the right `type` and owner, then filter to the current repo client-side
- [ ] The count line reports `count: N of T total` with `T` from the client-side-filtered set
- [ ] A missing query yields `VALIDATION_ERROR` (exit 2)
- [ ] `--state`, `--label`, `--limit`, and `--fields` work; default fields are the locator schema
- [ ] Empty results emit the standard `<noun>[0]: (none)` empty state
- [ ] Fixture-server tests cover both types, cross-repo results being filtered out, and the missing-query validation
- [ ] End-to-end tests run `search issues` and `search prs` against a live Gitea instance and assert real matches are returned with the locator schema, confirming the live search-endpoint response shape and the `type`/`owner`/`q` query behavior the fixture server cannot attest to
