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

- [x] Bare `gitea-axi` renders the header, `repo:` line, up to 3 issues and 3 PRs with the specified fields (including the computed `review`), and a `help:` block hinting at `--full`
- [x] `gitea-axi --full` renders the PR table capped at 20 rows with `count: 20 of T total` and issue counts grouped by label
- [x] Label aggregation paginates to the 1000-issue cap, suffixes counts with `+` when capped, counts each issue under all its labels, and shows `unlabeled` only when nonzero
- [x] Empty states render `prs: 0 open` / `issues: 0 open` as raw strings
- [x] Issue fetches pass `type=issues` so PRs never appear in the issue block
- [x] Outside a Gitea repo the dashboard exits with `REPO_NOT_FOUND` and help mentioning `-R` and `--login`
- [x] Fixture-server tests cover both tiers, the cap-and-suffix behavior, empty states, and the no-repo error
- [x] End-to-end tests render the bare dashboard and `--full` against a live Gitea instance, confirming the live issue/PR list response shapes and that the computed `review` and label-aggregation fields hold against real responses — behavior the fixture server cannot attest to

## Implementation Notes

The two tiers live in a new `src/commands/dashboard.ts` wired as the SDK's `home` handler.
The handler returns a **string** (not an object), so the SDK prepends the `bin:`/`description:` header verbatim above the dashboard's bespoke layout — the raw `prs: 0 open` / `issues: 0 open` empty-state lines and the label→count record cannot be expressed as a plain object for the SDK to encode.

`--full` is extracted in `runCli` before the SDK dispatches, and only when it is the sole remaining argument (after the global `-R`/`--login` flags are stripped).
This is because the SDK rejects any flag placed before a command, so `gitea-axi --full` would otherwise never reach the `home` handler; the extraction leaves an empty argv for the SDK and threads a `full` boolean into `dashboardCommand`.

`paginate.ts`'s `PaginatedResult` gained a `capped` flag: `fetchAllPages` now reports whether it stopped at the 20-page/1000-item cap with every page full, which drives the `+` suffix on the label counts.
The addition is backward-compatible — existing callers destructure only `items`/`total`.

Decisions made mid-implementation (all beyond the literal spec, kept deliberately):

- **Label-count ordering.** The spec fixes *what* to count but not the order; the `issues:` record is emitted by descending count, ties broken by name ascending, with `unlabeled` always last — a stable, at-a-glance ordering rather than an arbitrary one.
- **Defensive PR cap.** `fetchOpenPulls` slices the returned page to the requested limit so a server that ignored `limit=20` cannot inflate the table (or the review-fetch fan-out) past the cap.
- **Count line always present in the full tier**, including the empty case (`count: 0 of 0 total` above `prs: 0 open`), consistent with the list commands' count-line convention.
- **Top-level `--help`** gained a short note that the bare command shows the dashboard and `--full` selects the rich view, for discoverability.

The short and full tiers each re-slot the computed `review` after the PR fields via a local `prRowsWithReview` helper rather than sharing `pr list`'s inline loop — `pr list` also merges `--fields` extras into the same row, so the two are not the same operation despite the shared "review after the fields" shape (ADR 0006).
