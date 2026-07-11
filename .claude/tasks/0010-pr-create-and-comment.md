---
spec: gitea-axi
blocked-by: 0004-issue-create-and-comment
---

## What to build

`pr create` and `pr comment`.
`pr create` takes `--title` (required), `--body`/`--body-file`, `--base`, `--head`, `--assignee`, `--reviewer`, repeatable `--label` (name-resolved), and `--milestone` (name-resolved); `--draft` and `--project` are excluded (no Gitea API support).
When `--head` is omitted it defaults to the current local branch from git; when `--base` is omitted it defaults to the repository's default branch fetched from the repo endpoint.
Idempotent: before creating, check for an existing open PR for the same base/head pair; if found, return `pull_request: { number, url, already: true }` instead of creating a duplicate.
Success output is the action block `created: { number, url }` — action block when the mutation ran, entity block when it was a no-op.
`pr comment <n>` posts through the shared issue-comment endpoint and returns the created comment as `comment: { number, author, created, body }` (800-char truncation), diverging from gh-axi's status-only block to save a follow-up view call (see ADR 0008).

## Acceptance criteria

- [ ] `pr create --title` creates a PR and outputs `created: { number, url }`
- [ ] Omitted `--head` resolves to the current local branch; omitted `--base` resolves to the repo's default branch
- [ ] An existing open PR for the same branch pair short-circuits to `pull_request: { number, url, already: true }` with no duplicate created
- [ ] `--label` and `--milestone` resolve names case-insensitively with `VALIDATION_ERROR` on unknown names; `--assignee` and `--reviewer` pass through
- [ ] `pr comment <n> --body` outputs `comment: { number, author, created, body }` from the POST response, body truncated at 800 chars
- [ ] Missing required inputs (`--title` on create, body on comment) fail with `VALIDATION_ERROR` (exit 2) before any API call
- [ ] Fixture-server tests cover creation with defaults, the idempotent short-circuit, name resolution failures, and the comment output shape
