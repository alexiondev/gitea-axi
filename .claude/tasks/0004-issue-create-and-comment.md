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

- [ ] `issue create --title` creates an issue and outputs `issue: { number, title, state, url }` where `url` is `html_url`
- [ ] Missing `--title` fails immediately with `VALIDATION_ERROR` (exit 2) before any API call
- [ ] `--body-file <path>` reads the body from a file; `--body` and `--body-file` together are rejected
- [ ] `--label` resolves each name to an ID via case-insensitive lookup against the repo's labels; an unknown name yields `VALIDATION_ERROR`
- [ ] `--milestone` resolves the name via the milestone query; an unknown name yields `VALIDATION_ERROR`
- [ ] `issue comment <n> --body` posts and outputs `comment: { number, author, created, body }` built from the POST response, body cleaned and truncated at 800 chars, where `number` is the issue number
- [ ] `issue comment` accepts a PR number without a type-guard error
- [ ] Fixture-server tests cover create with labels/milestone, both body sources, comment output shape, and each validation failure
