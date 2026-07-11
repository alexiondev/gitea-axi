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

- [x] `issue view <n>` renders the default detail fields plus `comment_count` via renderDetail
- [x] Bodies over 500 chars are cleaned then truncated with the inline hint `"... (truncated, N chars total - use --full to see complete body)"`; bodies at or under the limit pass through untouched
- [x] cleanBody normalizes issue/PR URLs using the detected hostname, strips image embeds and long URLs, and collapses quoted blocks
- [x] `--comments` renders every comment (no cap), each body cleaned and truncated at 800 chars
- [x] `--full` returns raw, untruncated body and comment bodies
- [x] A PR number yields `VALIDATION_ERROR` (exit 2) with the "is a pull request" message and a `pr view <n>` help line, detected via the fetched object's `pull_request` field
- [x] A nonexistent issue yields `ISSUE_NOT_FOUND` (exit 1)
- [x] Single-entity next-step suggestions fill the actual issue number rather than a placeholder
- [x] Fixture-server tests cover truncation boundaries, cleanBody transforms, `--comments`, `--full`, and the type guard

## Implementation Notes

The cleaning/truncation machinery lives in a new `src/body.ts` (`cleanBody`, `truncateBody`, and the `BODY_TRUNCATE_LIMIT`/`COMMENT_TRUNCATE_LIMIT` constants) so the later issue/PR slices can reuse it.
`renderDetail` was added to `src/render.ts` alongside `renderList`, sharing a private `encodeRows` helper for the `(none)` empty-block form.

`comment_count` is emitted only in the default view; when `--comments` is passed, the full `comments` block replaces it rather than sitting alongside a redundant scalar.
This matches gh-axi's documented behaviour ("with `--comments`, the comments block is appended") — the spec lists `comment_count` as a default field but does not require it to persist under `--comments`.
When there are no comments, `comment_count` renders as the bare number `0` (no `use --comments` hint, since there is nothing to expand).

The `--full` next-step suggestion fires whenever the rendered body differs from the raw body — i.e. it was cleaned-under-limit *or* truncated — read directly off the rendered output rather than recomputing the over-limit threshold, so the suggestion can never drift from `truncateBody`'s own decision.

The default detail fields (`number`, `title`, `state`, `author`, `created`) reuse the shared `FieldDef`/`extractRow` extraction from the list path; only `body` and `comment_count` are handled bespokely.
As a consequence the displayed `number` comes straight from the fetched issue rather than falling back to the requested number, which is safe because the get-issue endpoint always returns it.
