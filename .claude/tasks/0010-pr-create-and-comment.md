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

- [x] `pr create --title` creates a PR and outputs `created: { number, url }`
- [x] Omitted `--head` resolves to the current local branch; omitted `--base` resolves to the repo's default branch
- [x] An existing open PR for the same branch pair short-circuits to `pull_request: { number, url, already: true }` with no duplicate created
- [x] `--label` and `--milestone` resolve names case-insensitively with `VALIDATION_ERROR` on unknown names; `--assignee` and `--reviewer` pass through
- [x] `pr comment <n> --body` outputs `comment: { number, author, created, body }` from the POST response, body truncated at 800 chars
- [x] Missing required inputs (`--title` on create, body on comment) fail with `VALIDATION_ERROR` (exit 2) before any API call
- [x] Fixture-server tests cover creation with defaults, the idempotent short-circuit, name resolution failures, and the comment output shape

## Implementation Notes

**Reused wholesale from task 0004.**
`resolveBodySource`/`requireBodySource`, `resolveLabelIds`/`resolveMilestoneId`, and the `repeatable` flag kind all carried over untouched — `pr create` added no new shared machinery of its own beyond what is listed below.

**New shared machinery.**
`src/comment.ts` (`COMMENT_FLAGS`, `commentItem`) now owns the `comment: { number, author, created, body }` block that ADR 0008 requires `issue comment` and `pr comment` to emit identically; it existed twice after the first draft, which is exactly the drift that ADR forbids, so it was extracted and `issue comment` moved onto it.
`parsePositionalNumber` (in `src/flags.ts`) replaces `issue.ts`'s private `parseIssueNumber`, taking the noun ("issue", "pull request") as a parameter; the issue-side messages are unchanged.
`httpStatus` (in `src/errors.ts`) exposes the status of a failed call for the callers that give one status a meaning of their own before falling back to `classifyHttpError`.
`currentBranch` (in `src/git.ts`) reads `git rev-parse --abbrev-ref HEAD`, as the spec names.

**A closed PR for the same branch pair does not short-circuit.**
Gitea's by-base-head lookup matches on the branches alone, so it can answer with a closed or merged PR.
The spec says the check is for "an existing *open* PR", and the branches of a closed one are free to be proposed again, so only an open PR short-circuits.

**Names are resolved before the existence check, not after.**
Whether a label name is real does not depend on remote state, so a typo is reported the same way whether or not the PR already exists.
The alternative ordering saves one API call on the short-circuit path but makes a misspelled `--label` fail on the first run and pass silently on the second.

**Deviation: `pr comment` also accepts `--full`.**
The spec lists only `--body`/`--body-file` for it, but the shared 800-char truncation hint reads "use `--full` to see complete body", and without the flag that hint names a command that errors out.
This is the same deviation, for the same reason, that `issue comment` took in task 0004.

**Deviation: a 404 from `pr comment` is `PR_NOT_FOUND`, not `ISSUE_NOT_FOUND`.**
The spec's status table classifies 404s by path, and PR comments go through `/issues/{index}/comments`, which would report a missing PR as a missing issue.
The table's own header is "HTTP status | Context | Error code", and the command knows its target is a pull request, so the calling context wins over the path here.

**Deviation: next-step suggestions point at `pr comment`, not `pr view`.**
gh-axi's reference suggests `pr view <id>` after both commands, but `pr view` does not exist until task 0009, and task 0004 already established that this tool does not hand back a command guaranteed to fail.
**Follow-up:** task 0009 should upgrade the `pr create` and `pr comment` help lines to `pr view` once it lands.

**Beyond the ask: the end-to-end tier.**
The criteria call only for fixture-server tests, but fixtures can only replay an answer they were told to give, and the whole idempotency check rests on how live Gitea's by-base-head lookup actually behaves (404 when no PR matches; the open PR when one does).
`test/e2e/mutations.test.ts` now seeds a branch and asserts both against a live instance, so a wrong assumption fails CI rather than surfacing as a duplicate PR.
The two e2e suites share one provisioned instance via `instanceOnce()`.

**Review findings left unaddressed.**
The optional-field payload assembly in `prCreate` mirrors `issueCreate`'s, and `repoOnBranch`/`gitEnv` in `test/pr-create.test.ts` overlap with `detection.test.ts`'s private git-sandbox helpers; both are shapes rather than logic, and collapsing them would mean either a generic `assignDefined` helper or dragging the fake-`tea` sandbox machinery into `harness.ts`.
Left alone deliberately, to be revisited if a third caller appears.

**Follow-up worth flagging.**
Coverage is now 95.9% statements / 90.1% branches against thresholds of 92/87; the ratchet in `vitest.config.ts` invites raising them, but that belongs in its own commit rather than a feature task, as the last raise was.
