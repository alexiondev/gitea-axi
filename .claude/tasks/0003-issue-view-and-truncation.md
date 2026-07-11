---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

`issue view <n>` as a detail command, introducing the content-truncation and cleanBody machinery that later slices reuse.
Default output: `number`, `title`, `state`, `author`, `created`, `body` (truncated at 500 chars), plus `comment_count`.
`--comments` renders all comments with no count cap, each body truncated at 800 chars with cleanBody applied.
`--full` suppresses all truncation in the output — issue body and comment bodies alike.
cleanBody runs only when the raw body exceeds the truncation limit: it normalizes Gitea issue/PR URLs on the detected hostname to `Issue#N`/`PR#N`, strips markdown image embeds, removes long URLs, and collapses email-style quoted blocks; if cleaning brings the body under the limit the cleaned body is returned with a note, otherwise it is truncated with the inline hint.
Type guard: viewing a PR number fails with `VALIDATION_ERROR` ("issue #N is a pull request") and a `pr view <n>` help line.
No `type` field and no sub-issue augmentation.

## Acceptance criteria

- [ ] `issue view <n>` renders the default detail fields plus `comment_count` via renderDetail
- [ ] Bodies over 500 chars are cleaned then truncated with the inline hint `"... (truncated, N chars total - use --full to see complete body)"`; bodies at or under the limit pass through untouched
- [ ] cleanBody normalizes issue/PR URLs using the detected hostname, strips image embeds and long URLs, and collapses quoted blocks
- [ ] `--comments` renders every comment (no cap), each body cleaned and truncated at 800 chars
- [ ] `--full` returns raw, untruncated body and comment bodies
- [ ] A PR number yields `VALIDATION_ERROR` (exit 2) with the "is a pull request" message and a `pr view <n>` help line, detected via the fetched object's `pull_request` field
- [ ] A nonexistent issue yields `ISSUE_NOT_FOUND` (exit 1)
- [ ] Single-entity next-step suggestions fill the actual issue number rather than a placeholder
- [ ] Fixture-server tests cover truncation boundaries, cleanBody transforms, `--comments`, `--full`, and the type guard
