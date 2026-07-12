---
spec: gitea-axi
blocked-by: 0003-issue-view-and-truncation
---

## What to build

The first mutations: `issue create` and `issue comment`, introducing the shared machinery for `--body-file`, name→ID resolution, and mutation output blocks.
`issue create` takes `--title` (required), `--body`/`--body-file`, `--assignee`, repeatable `--label` (resolved to label ID via the case-insensitive label lookup), and `--milestone` (resolved via the milestone name query); `--project` and `--type` are excluded.
Create output is the entity block `issue: { number, title, state, url }` with extra fields (`labels`, `assignees`, `milestone`, `body`) available via `--fields`.
`issue comment <n>` requires `--body`/`--body-file` and returns the created comment directly from the POST response as `comment: { number, author, created, body }` with the body truncated at 800 chars — no follow-up view call needed; the comment's own id is not output.
`issue comment` stays permissive toward PR numbers (PRs genuinely share the comment endpoint).

## Acceptance criteria

- [x] `issue create --title` creates an issue and outputs `issue: { number, title, state, url }` where `url` is `html_url`
- [x] Missing `--title` fails immediately with `VALIDATION_ERROR` (exit 2) before any API call
- [x] `--body-file <path>` reads the body from a file; `--body` and `--body-file` together are rejected
- [x] `--label` resolves each name to an ID via case-insensitive lookup against the repo's labels; an unknown name yields `VALIDATION_ERROR`
- [x] `--milestone` resolves the name via the milestone query; an unknown name yields `VALIDATION_ERROR`
- [x] `issue comment <n> --body` posts and outputs `comment: { number, author, created, body }` built from the POST response, body cleaned and truncated at 800 chars, where `number` is the issue number
- [x] `issue comment` accepts a PR number without a type-guard error
- [x] Fixture-server tests cover create with labels/milestone, both body sources, comment output shape, and each validation failure

## Implementation Notes

**Shared machinery introduced here** (all of it is what `pr create` in task 0010 reuses):
`src/body-source.ts` (`resolveBodySource` / `requireBodySource`) resolves `--body` vs `--body-file`;
`src/lookup.ts` (`resolveLabelIds`, `resolveMilestoneId`) does name→ID resolution;
`parseFlags` grew a `repeatable` flag kind, accumulating occurrences into a separate `lists` map so `--label` can repeat without changing the type of the single-valued `flags` map;
`fields.ts` grew the `joined` array-join extractor and `selectExtraFields` for `--fields`.

**Label lookup paginates.** The spec just says `GET /labels`, but that endpoint pages (default 30), so a repo with more labels than one page would fail to resolve a perfectly valid name. `listAllLabels` pages at 50 until exhausted, with a 20-page (1000-label) runaway guard.

**`--fields` is additive, not a replacement.** The spec calls these "extra fields available via `--fields`", so the four default fields always render and `--fields` appends to them. An unknown name is a `VALIDATION_ERROR` listing the valid ones rather than being ignored.

**Milestone resolution re-checks the title client-side.** The `?name=` query only narrows the candidates; the returned title is then compared case-insensitively, so neither the caller's casing nor a looser server-side match (Gitea filters with a `LIKE`) can resolve to a milestone the caller did not name. Whether Gitea's filter is itself case-insensitive is the one assumption fixtures cannot settle, so the end-to-end tier now seeds a mixed-case label and milestone and passes both in a *different* case — if the live behaviour differs, CI fails rather than the user finding out.

**Deviation: `issue comment` also accepts `--full`.** The spec lists only `--body`/`--body-file` for it. But the shared 800-char truncation hint literally reads "use `--full` to see complete body", and without the flag that hint names a command that errors out. The flag is documented in `issue comment --help`.

**Deviation: no `issue view` suggestion after commenting on a PR.** `issue comment` is deliberately permissive toward PR numbers, but `issue view` type-guards them — so the obvious next-step suggestion would have been a command guaranteed to fail. The PR case is detected from the POST response's `pull_request_url` (no extra call) and falls back to the `--help` suggestion; `pr view` will be the right suggestion once task 0009 lands it.

**Follow-up worth flagging.** `src/commands/issue.ts` is now ~540 lines holding four subcommands, each with its own help text, field table, and suggestion builder. It's readable today, but tasks 0005–0007 add five more subcommands to it; a split into `src/commands/issue/<subcommand>.ts` is the natural next move, and is better done as its own refactor than smuggled into a feature task.
