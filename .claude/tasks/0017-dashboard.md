---
spec: gitea-axi
blocked-by: 0008-pr-list
---

## What to build

The two-tier dashboard: `gitea-axi` with no arguments, preceded by the `bin:` + `description:` header from axi-sdk-js and followed by next-step suggestions (see ADR 0012).
The short tier fetches up to 3 open issues (`number`, `title`, `state`, `author`) and up to 3 open PRs (`number`, `title`, `author`, `review`) in parallel with `limit=3`, computing `review` via the same parallel review fetch as `pr list`; its `help:` block always hints at `--full`.
The full tier (`--full`) shows open PRs as a TOON table (default fields `number`, `title`, `author`, `labels`, `review`; capped at 20 rows with a standard count line) and open issue counts grouped by label — aggregating all pages of open issues at page size 50 up to a hard cap of 1000, suffixing counts with `+` if capped; each issue contributes to all its labels, with a nonzero-only `unlabeled` row.
Output blocks in both tiers: a `repo:` line, then `prs:` and `issues:`; empty states are the raw strings `prs: 0 open` / `issues: 0 open`.
Issue fetching passes `type=issues`; outside a recognizable Gitea repo the dashboard errors with `REPO_NOT_FOUND` and `-R` + `--login` help — even when invoked by the SessionStart hook (see ADR 0009).

## Acceptance criteria

- [ ] Bare `gitea-axi` renders the header, `repo:` line, up to 3 issues and 3 PRs with the specified fields (including the computed `review`), and a `help:` block hinting at `--full`
- [ ] `gitea-axi --full` renders the PR table capped at 20 rows with `count: 20 of T total` and issue counts grouped by label
- [ ] Label aggregation paginates to the 1000-issue cap, suffixes counts with `+` when capped, counts each issue under all its labels, and shows `unlabeled` only when nonzero
- [ ] Empty states render `prs: 0 open` / `issues: 0 open` as raw strings
- [ ] Issue fetches pass `type=issues` so PRs never appear in the issue block
- [ ] Outside a Gitea repo the dashboard exits with `REPO_NOT_FOUND` and help mentioning `-R` and `--login`
- [ ] Fixture-server tests cover both tiers, the cap-and-suffix behavior, empty states, and the no-repo error
- [ ] End-to-end tests render the bare dashboard and `--full` against a live Gitea instance, confirming the live issue/PR list response shapes and that the computed `review` and label-aggregation fields hold against real responses — behavior the fixture server cannot attest to
