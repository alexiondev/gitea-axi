## Problem Statement

Coding agents that need to drive a Gitea-hosted workflow (issues, pull requests, labels) today have two poor options.
The official `tea` CLI is human-oriented: it has no token-efficiency, no contextual guidance, and no agent-facing error conventions.
Gitea's MCP servers expose the full API surface (dozens of tools) rather than being tuned for token or turn efficiency.
There is no Gitea-focused tool built to the same "agent ergonomics" standard that `gh-axi` established for GitHub.

## Solution

Build `gitea-axi`: a thin TypeScript CLI that calls the Gitea REST API directly via `gitea-js`, reshaping its output according to all 10 AXI (Agent eXperience Interface) principles.
The canonical principle text at https://axi.md/ is the design authority.
The `gh-axi` reference implementation is a non-binding shape reference for concrete interface details (block names, flag names, field extractors), departed from freely — with each deliberate departure documented in place.
It gives coding agents an ergonomic, low-token way to drive issues and pull requests on any Gitea instance.
It ships as both an installable npm CLI and a bundled Agent Skill, so any agent session can adopt it with one install step.

## User Stories

1. As a coding agent, I want to create a Gitea issue with a title, body, and labels, so that I can record work items for later retrieval.
2. As a coding agent, I want to find issues by label and state, so that I can locate relevant work without already knowing its issue number.
3. As a coding agent, I want to read an issue's full body, labels, and comments, so that I can load its context into a session.
4. As a coding agent, I want to add and remove labels on an existing issue, so that I can reflect state transitions as work progresses.
5. As a coding agent, I want to create a pull request from the current branch, so that completed work becomes reviewable.
6. As a coding agent, I want to fetch a pull request's metadata and diff, so that review tooling can operate on it without re-deriving it from git.
7. As a coding agent, I want to post a comment on a pull request, so that findings or notes are visible as a permanent reference on the PR itself.
8. As a coding agent, I want command output in TOON format with minimal default fields and truncated large fields, so that repeated calls across a long-running session don't consume excessive context.
9. As a coding agent, I want pre-computed aggregates in list and read output, so that I don't need follow-up calls just to derive obvious derived fields.
10. As a coding agent, I want explicit empty-state output when a query returns nothing, so that "no results" is never ambiguous with an error or a hang.
11. As a coding agent, I want structured errors with actionable suggestions and meaningful exit codes instead of prose failures, so that I can self-correct without the operator's help.
12. As a coding agent, I want mutations to be idempotent and to never prompt interactively, so that unattended, scripted use never stalls or double-applies.
13. As a coding agent, I want contextual next-step suggestions appended after output, so that I know what to call next without being taught the tool from scratch every session.
14. As a coding agent, I want a consistent per-subcommand `--help`, so that I can discover the interface on demand rather than needing it pre-loaded in context.
15. As an operator, I want `gitea-axi` run with no arguments to show live, actionable repository state instead of a help screen, so that I get immediate value without memorizing flags.
16. As an operator, I want `gitea-axi` to reuse my existing `tea` login configuration, so that I don't manage a second set of credentials.
17. As an operator, I want `gitea-axi`'s command surface to stay generic, with no workflow-specific behavior baked in, so that it's useful across different projects without code changes.
18. As an operator, I want `gitea-axi` published to npm and as an installable Agent Skill, so that I (and others) can adopt it with a single install command plus an explicit one-time `gitea-axi setup`.
19. As an operator, I want an optional `gitea-axi setup hooks` command that injects the dashboard into my agent sessions at session start, so that my agent begins each session already aware of the repository's live state.

## Implementation Decisions

### Language and Runtime

TypeScript on Node 20+, matching the `gh-axi` reference implementation.
ESM module format.

### Implementation Strategy

Call the Gitea REST API directly via `gitea-js` (the official TypeScript client generated from Gitea's OpenAPI spec).
This is not a subprocess wrapper — it is a direct HTTP API client.

Tea was evaluated as a subprocess target and rejected during design (see ADR 0002).
The short version: tea's create commands have no `--output json` flag, its PR list has no head-branch filter, it exposes no review or total counts in JSON, and diff content requires a direct HTTP GET regardless — making a tea wrapper a patchwork of subprocess calls and text parsing rather than a clean pipeline.

`gitea-js` gives clean typed responses, `X-Total-Count` headers for pagination, review counts, and immediate JSON from create operations.

### Auth

gitea-axi reads credentials from tea's login store via `tea login list --output json`.
It requires `tea` to be installed and at least one login configured via `tea login add`.
At startup, it detects the current repository's Gitea hostname (see Repository Context Detection), finds the matching login entry, and extracts the token for all subsequent API calls.
When multiple logins match the hostname: if tea's default login is among them it is used; otherwise `VALIDATION_ERROR` listing the matching profile names, with help to pass `--login <name>` — an arbitrary identity is never picked silently.
Tea is used only for credential discovery — no commands are dispatched through the tea subprocess.

### Command Surface

#### Dashboard

`gitea-axi` (no args): a two-tier home view showing live repository state, preceded by the `bin:` + `description:` header from `axi-sdk-js`, followed by next-step suggestions (see ADR 0012).

The short tier (no flags — also what the SessionStart hook runs) matches gh-axi's home shape:
up to 3 open issues (`number`, `title`, `state`, `author`) and up to 3 open PRs (`number`, `title`, `author`, `review`), fetched in parallel with `limit=3`.
The `review` field is computed client-side via the same parallel review fetch as `pr list` (see ADR 0006) — at most 3 extra HTTP calls.
The short tier's `help:` block always includes a hint pointing at `--full`.

The full tier (`gitea-axi --full`): open PRs as a TOON table and open issue counts grouped by label (a label→count record).
Full-tier PR table default fields: `number`, `title`, `author` (plucked from `user.login`), `labels` (joined label names), `review` (same client-side computation).
The full-tier PR table is capped at 20 rows with a standard count line (`count: 20 of T total`).
Full-tier issue aggregation fetches all pages of open issues up to a hard cap of 1000 (page size 50, 20 pages max); if the cap is hit, label counts are suffixed with `+`.
`--full` here selects the full tier — an intentional overload of the flag that elsewhere suppresses truncation.

Output blocks (both tiers): a `repo: owner/name` line, then `prs:` and `issues:`.
Empty states are explicit and match gh-axi's home: `prs: 0 open` / `issues: 0 open` (raw strings; list commands keep their `<noun>[0]: (none)` convention).
Issue fetching passes `type=issues` so PRs never pollute the issue block (see Issue/PR Type Guard).
Outside a recognizable Gitea repo the dashboard errors with `REPO_NOT_FOUND` (help: use `-R` + `--login`) — login selection requires a hostname.
This holds even when invoked by the SessionStart hook; error noise in non-Gitea sessions is an accepted consequence (see ADR 0009).

#### Issue Commands

**`issue list [flags]`**
`--state <open|closed|all>` (default open);
`--label <name>` (API-supported — Gitea issue list accepts comma-separated label names);
`--assignee <login>` (API-supported — maps to `assigned_by` param);
`--author <login>` (API-supported — maps to `created_by` param);
`--milestone <name>` (API-supported — maps to `milestones` param);
`--sort <created|updated|comments>` (client-side — Gitea issue list has no sort param; always descending, matching gh-axi);
`--limit <n>` (default 30);
`--fields <a,b,c>`.
`--search` is explicitly forbidden (VALIDATION_ERROR; help: `` Use `gitea-axi search issues "<query>"` for full-text search ``).
Always passes `type=issues` — Gitea's issue endpoints also serve PRs, which must never appear in issue lists (see Issue/PR Type Guard).
Client-side `--sort` reorders without changing membership, so the standard `count: N of T total` line is kept (see ADR 0005); full pagination still precedes sorting.
Default output fields (matching gh-axi): `number`, `title`, `state` (lowercased), `author` (plucked from `user.login`), `created` (relative time).
Extra fields via `--fields`: `body` (raw), `closedAt` (relative time, as `closed_at`), `labels` (joined names), `milestone` (title), `updatedAt` (relative time, as `updated_at`), `url`.
No `type` field in output — Gitea has no issue types.

**`issue view <n> [flags]`**
`--comments` (expand full comments — renders all comments with no count cap, each body truncated at 800 chars with cleanBody applied);
`--full` (suppress all truncation in the output — issue body and comment bodies alike).
Default output fields (matching gh-axi, minus `type`): `number`, `title`, `state`, `author`, `created`, `body` (truncated at 500), plus `comment_count`.
Type guard: if `<n>` is a pull request, fails with `VALIDATION_ERROR` ("issue #N is a pull request") and a `pr view <n>` help line (see Issue/PR Type Guard).
No `type` field in output (Gitea has no issue types).
No sub-issue augmentation (Gitea does not model issue hierarchies; use `issue blocks` and `issue blocked-by` for dependency relationships).

**`issue create [flags]`**
`--title <text>` (required);
`--body <text>` or `--body-file <path>`;
`--assignee <login>`;
`--label <name>` (repeatable; resolved to label ID via `GET /labels`, case-insensitive — `VALIDATION_ERROR` if not found);
`--milestone <name>` (resolved to milestone ID via `GET /milestones?name=<name>` — `VALIDATION_ERROR` if not found).
`--project` is excluded (Gitea has no projects REST API).
`--type` is excluded (Gitea has no issue types).
Output schema: `issue: { number, title, state, url }` (where `url` = `html_url`).
Extra fields available via `--fields`: `labels`, `assignees`, `milestone`, `body`.

**`issue edit <n> [flags]`**
`--title`;
`--body <text>` or `--body-file <path>`;
`--add-label <name>`;
`--remove-label <name>`;
`--add-assignee <login>`;
`--remove-assignee <login>`;
`--milestone <name>` (resolved to milestone ID via `GET /milestones?name=<name>` — `VALIDATION_ERROR` if not found).
Output on success: `edited: { number, status: "ok" }` — the action-block/entity-block pattern (see `pr create`) applied uniformly across issue and PR mutations; a deliberate departure from gh-axi, whose `issue edit` returns the updated `issue:` entity block.
Label mutations use Gitea's dedicated additive/removal label endpoints (idempotent).
`--add-label` passes the name directly via `POST /issues/{index}/labels` (Gitea accepts names here — no lookup needed).
`--remove-label` requires an ID: resolved via case-insensitive label lookup; `VALIDATION_ERROR` if the label name does not exist in the repo; if the label exists but is not applied to this issue, Gitea's 404 on `DELETE /labels/{id}` is treated as silent success.
Assignee mutations use fetch-then-patch: the current assignee list is read first, the addition or removal applied in-process, then the full resulting list is sent in a single PATCH (see ADR 0007).

**`issue close <n> [flags]`**
`--comment <text>`.
Closing sets `state: "closed"` via PATCH on the issue.
`--reason` is excluded (Gitea has no `state_reason` concept).
When `--comment` is provided, two API calls are made: PATCH to close, then POST to create the comment.
If the PATCH succeeds but the POST fails, the error is surfaced — the issue remains closed but the failure is reported rather than silently swallowed.
Output on success: `closed: { number, status: "ok" }` (action-block/entity-block pattern).
Idempotent: returns early with `message: "Already closed"` if already closed.

**`issue reopen <n>`**
Sets `state: "open"` via PATCH.
Output on success: `reopened: { number, status: "ok" }` (action-block/entity-block pattern).
Idempotent: returns early with `message: "Already open"` if already open.

**`issue comment <n> [flags]`**
`--body <text>` or `--body-file <path>` (required).
Gitea's `POST /issues/{index}/comments` returns the created `Comment` object directly.
Output block: `comment: { number, author, created, body }` (body truncated at 800 chars).
`number` is the issue number the comment was posted to; the comment's own id is not output (nothing in the command surface consumes comment ids).

**`issue delete <n>`**
Hard-deletes the issue via `DELETE /issues/{index}` (requires admin or owner permissions).
Not idempotent: a nonexistent issue errors with `ISSUE_NOT_FOUND` rather than reporting success (see ADR 0010).
Output: `issue: { number, status: "deleted" }`.

**`issue pin <n>`**
`POST /issues/{index}/pin`.
Idempotent: returns early with `message: "Already pinned"` if already pinned.
Output: `issue: { number, state, pinned }`.

**`issue unpin <n>`**
`DELETE /issues/{index}/pin`.
Idempotent: returns early with `message: "Already unpinned"` if already unpinned.
Output: `issue: { number, state, pinned }`.

**`issue blocks <list|add|remove>` (Gitea-specific)**
Manages the set of issues that this issue blocks (downstream dependents that cannot proceed until this issue is resolved).
`issue blocks list <n>` — lists issues blocked by `<n>`; output block `blocked_issues`.
`issue blocks add <n> <target>` — makes `<n>` block `<target>`; output `blocks: { issue: n, blocks: target }`.
`issue blocks remove <n> <target>` — removes the blocking relationship.
Idempotent: `add` of an existing relationship returns `already: true` (fetch-first check against the current list); `remove` of a nonexistent relationship is silent success; self-reference and cycle errors still surface as `VALIDATION_ERROR` via the 422 mapping.
Gitea API: `GET/POST/DELETE /repos/{owner}/{repo}/issues/{index}/blocks`.
No gh-axi equivalent.

**`issue blocked-by <list|add|remove>` (Gitea-specific)**
Manages the set of issues that block this issue (upstream blockers that must be resolved before this issue can proceed).
`issue blocked-by list <n>` — lists issues that block `<n>`; output block `blocking_issues`.
`issue blocked-by add <n> <blocker>` — makes `<n>` depend on `<blocker>`; output `blocked_by: { issue: n, blocked_by: blocker }`.
`issue blocked-by remove <n> <blocker>` — removes the dependency.
Same idempotency rules as `issue blocks`.
Gitea API: `GET/POST/DELETE /repos/{owner}/{repo}/issues/{index}/dependencies`.
No gh-axi equivalent.

#### Excluded Issue Commands

`issue lock` / `issue unlock` — excluded: Gitea exposes `is_locked` as a readable field but has no lock/unlock API endpoint.
`issue transfer` — excluded: no Gitea equivalent.
`issue subissue` — excluded: GitHub-specific hierarchy model; Gitea uses blocking/dependency relationships instead (see `issue blocks` and `issue blocked-by`).

#### PR Commands

**`pr list [flags]`**
`--state <open|closed|all>` (default open);
`--label <name>` (requires name→ID lookup — Gitea PR list takes `labels: number[]`; see label name lookup in CONTEXT.md);
`--label-id <id>` (Gitea-specific shortcut — bypasses the name→ID lookup and passes the ID directly);
`--assignee <login>` (client-side filter — Gitea PR list has no assignee param);
`--author <login>` (API-supported — maps to `poster` param);
`--base <branch>` (client-side filter — no API param);
`--head <branch>` (client-side filter — no API param);
`--draft` (client-side filter — no API param);
`--sort <oldest|recentupdate|leastupdate|mostcomment|leastcomment|priority>` (Gitea-specific extension — maps directly to the API `sort` param);
`--limit <n>` (default 30);
`--fields <a,b,c>`.
`--search` is explicitly forbidden (VALIDATION_ERROR; help: `` Use `gitea-axi search prs "<query>"` for full-text search ``).
Default output fields (matching gh-axi): `number`, `title`, `state` (lowercased), `author` (plucked from `user.login`), `draft` (bool→yes/no), `review` (`reviewDecision` mapped: APPROVED→approved, CHANGES_REQUESTED→changes_requested, REVIEW_REQUIRED→required).
Extra fields via `--fields`: `body` (raw), `createdAt` (relative time, as `created`), `labels` (joined names), `milestone` (title), `mergedAt` (relative time, as `merged_at`), `url`.
`reviewDecision` is computed client-side by fetching reviews for each PR in parallel (one extra HTTP call per PR; see ADR 0006).
When any client-side filter is active, the count line shows `count: N of T total` with `T` computed from the in-memory filtered result set (see ADR 0005).

**`pr view <n> [flags]`**
`--comments` (renders all comments with no count cap, each body truncated at 800 chars with cleanBody applied);
`--reviews`;
`--full` (suppress all truncation in the output — PR body and comment bodies alike).
Default output fields (matching gh-axi): `number`, `title`, `state`, `author`, `draft`, `merged`, `checks`, `body` (truncated at 500), plus `comment_count` and `review_count`.
The `checks` field is populated from Gitea commit statuses via `GET /commits/{sha}/status` using the PR head SHA.
It renders as `"N passed, N failed[, N skipped][, N pending], N total"`, or `"0 passed, 0 failed — this PR has no CI checks configured"` when no statuses exist.
Commit status states map to gh-axi's four-value classification: `success`→`pass`; `failure`/`error`/`warning`→`fail` (matching Gitea's own combine logic, which treats `warning` as failure); `skipped`→`skip`; `pending`→`pending`.
Older Gitea instances never emit `skipped`, so the `skip` bucket is simply absent there.
`pr view` always makes three API calls: the PR fetch and `GET /pulls/{index}/reviews` are issued in parallel, then the combined-status fetch runs once the head SHA is known — so `review_count` and `checks` are always in the default output without requiring `--reviews`.
When `--reviews` is passed, additionally fetches per-review inline comments (`GET /pulls/{index}/reviews/{id}/comments` for each review).
Gitea-specific fields exposed on review objects when `--reviews` is passed: `official` (whether the review counts toward required approvals) and `stale` (whether the PR head has moved since review submission).

**`pr create [flags]`**
`--title <text>` (required);
`--body <text>` or `--body-file <path>`;
`--base <branch>`;
`--head <branch>`;
`--assignee <login>`;
`--reviewer <login>`;
`--label <name>` (repeatable; resolved to label ID via `GET /labels`, case-insensitive — `VALIDATION_ERROR` if not found);
`--milestone <name>` (resolved to milestone ID via `GET /milestones?name=<name>` — `VALIDATION_ERROR` if not found).
`--draft` is excluded (Gitea cannot create draft PRs via API).
`--project` is excluded (Gitea has no projects REST API).
When `--head` is not specified, defaults to the current local branch (via `git rev-parse --abbrev-ref HEAD`).
When `--base` is not specified, the repository's default branch is used (fetched via `GET /repos/{owner}/{repo}`).
Idempotent: before creating, checks `GET /pulls/{base}/{head}` for an existing open PR for the same branch pair.
If found, returns `pull_request: { number, url, already: true }` without creating a duplicate.
Output on success: `created: { number, url }` — completing gh-axi's action-block/entity-block pattern (action-named block when the mutation ran, entity-named block when it was a no-op).

**`pr edit <n> [flags]`**
`--title`;
`--body <text>` or `--body-file <path>`;
`--add-label <name>`;
`--remove-label <name>`;
`--add-assignee <login>`;
`--remove-assignee <login>`;
`--add-reviewer <login>`;
`--remove-reviewer <login>`;
`--milestone <name>` (resolved to milestone ID via `GET /milestones?name=<name>` — `VALIDATION_ERROR` if not found);
`--base <branch>`.
Assignee mutations use fetch-then-patch (see ADR 0007).
Reviewer mutations use Gitea's dedicated review-request endpoints (`POST`/`DELETE /pulls/{index}/requested_reviewers` with `{ reviewers: [login] }`) — `EditPullRequestOption` has no reviewers field, so fetch-then-patch is structurally impossible for reviewers (see ADR 0007 amendment).
Output: `edited: { number, status: "ok" }`.

**`pr close <n> [flags]`**
`--comment <text>`.
When `--comment` is provided, two API calls are made (PATCH to close, then POST the comment); if the PATCH succeeds but the POST fails, the error is surfaced — same partial-failure policy as `issue close`.
Idempotent: returns `pull_request: { number, state, already: true }` if already closed or merged.
Output on success: `closed: { number, status: "ok" }`.

**`pr merge <n> [flags]`**
`--method <merge|squash|rebase|rebase-merge|fast-forward-only|manually-merged>`;
`--merge`, `--squash`, `--rebase` (shorthands for the three common methods);
`--auto`;
`--delete-branch`;
`--body <text>` or `--body-file <path>`;
`--subject <text>`;
`--merge-commit-id <sha>` (required when `--method manually-merged`; VALIDATION_ERROR if omitted; VALIDATION_ERROR if provided with any other method).
Gitea-specific methods not in gh-axi: `rebase-merge` (rebase + explicit merge commit), `fast-forward-only`, `manually-merged` (records an out-of-band merge without actually merging).
Idempotent: if already merged, returns `pull_request: { number, state: "merged", merged_by, merged_at }` without calling the API.
Output on success: `merged: { number, status: "ok", method }`.

**`pr review <n> [flags]`**
`--approve`;
`--request-changes`;
`--comment`;
`--body <text>` or `--body-file <path>`.
Exactly one of the three action flags is required; zero or multiple → `VALIDATION_ERROR` before any API call (mirroring the `pr merge` shorthand-conflict rule).
Body requirements are not pre-validated locally: if Gitea rejects a body-less review event, its 422 surfaces as `VALIDATION_ERROR` with the server's message.
Output: `review: { number, action }`.

**`pr checks <n>`**
Fetches combined commit status for the PR head SHA via `GET /commits/{sha}/status`.
Output matches gh-axi: a `summary` line (`N passed, N failed[, N skipped][, N pending], N total`) followed by a `checks` list of `{ name, conclusion }`.
Conclusions: `pass`, `fail`, `skip`, or `pending`, using the same state mapping as `pr view` (`skipped`→`skip`; `warning`→`fail`).
When no statuses are configured: `checks: "0 passed, 0 failed — this PR has no CI checks configured"`.

**`pr diff <n> [flags]`**
`--full`.
Fetches raw diff from `GET /pulls/{index}.diff`.
Truncation limit: 4000 chars.
Output: `pr_diff: { number, diff[, truncated, original_length] }`.

**`pr checkout <n>`**
Fetches the PR head branch name from `GET /pulls/{index}` (`head.ref` field), then runs in the current working directory, three-cased on the local branch state so a re-checkout is idempotent (git refuses to fetch into the checked-out branch, and a moved PR head makes the plain fetch non-fast-forward):
1. Branch absent: `git fetch origin pull/<n>/head:<branch>`, then `git checkout <branch>`.
2. Branch exists, not checked out: `git fetch origin +pull/<n>/head:<branch>` (force — the branch mirrors the PR head), then `git checkout <branch>`.
3. Branch currently checked out: `git fetch origin pull/<n>/head`, then `git merge --ff-only FETCH_HEAD`; if not fast-forwardable (local commits diverge from the PR head), `GIT_ERROR` with a help line explaining the divergence — local commits are never discarded silently.
Fetching `refs/pull/{index}/head` from the base repo works uniformly for same-repo and fork PRs — the head branch itself may live in a fork that is not a configured remote (see ADR 0011).
Git subprocess failures (dirty worktree, network) map to `GIT_ERROR`, carrying git's first stderr line and a remediation help line.
Output: `checkout: { number, branch, status: "ok" }`.

**`pr reopen <n>`**
Idempotent: returns `pull_request: { number, state: "open", already: true }` if already open.
Output on success: `reopened: { number, status: "ok" }`.

**`pr comment <n> [flags]`**
`--body <text>` or `--body-file <path>` (required).
PRs share the issue comment endpoint in Gitea (`POST /issues/{index}/comments`), which returns the created `Comment` object directly.
Output block: `comment: { number, author, created, body }` (body truncated at 800 chars).
`number` is the PR number the comment was posted to; the comment's own id is not output.
This diverges from gh-axi's `commented: { number, status: "ok" }` — returning the created comment eliminates the need for a follow-up view call (AXI Principle 4; see ADR 0008).

**`pr update-branch <n> [flags]`**
`--style <merge|rebase>` (Gitea-specific; default `merge`).
Merges the base branch into the PR head branch via `POST /pulls/{index}/update?style=<style>`.
Output: `updated: { number, status: "ok" }`.

#### Excluded PR Commands

`pr ready` — excluded: Gitea has no API to convert a draft PR to ready for review.
`pr revert` — excluded: Gitea has no revert PR endpoint.

#### Label Commands

**`label list [flags]`**
`--limit <n>` (default 500).
Output: count line followed by `labels: [ { name } ]`.

**`label create [flags]`**
`--name <text>` (required);
`--color <hex>` (required, without `#`).
The `#` prefix is automatically prepended before calling the Gitea API (which requires it in `CreateLabelOption.color`).
`--description <text>`.
Idempotent: checks for an existing label with the same name (case-insensitive) before creating.
If found: `create: already_exists`, `label: <existing-name>`.
Output on success: `created: ok`, `label: <name>`.

**`label edit <name> [flags]`**
`--name <new-name>`;
`--color <hex>`;
`--description <text>`.
`<name>` is resolved via the standard case-insensitive label lookup; `VALIDATION_ERROR` if not found.
Output: `edit: ok`, `label: <new-name-or-original-name>`.

**`label delete <name>`**
`<name>` is resolved via the standard case-insensitive label lookup.
Not idempotent: a nonexistent label errors with `VALIDATION_ERROR` rather than reporting success (see ADR 0010).
Output: `delete: ok`, `label: <name>`.

#### Search Commands

**`search issues <query> [flags]`** / **`search prs <query> [flags]`**
Full-text search within the current repository, added because `--search` on the list commands is forbidden and agents need a text-query escape hatch (the forbidden-flag error redirects here, mirroring gh-axi).
The positional `<query>` is required (`VALIDATION_ERROR` if missing).
Endpoint: `GET /repos/issues/search` with `q=<query>`, `type=issues` or `type=pulls`, and `owner=<owner>`.
The endpoint has no repo-name filter, so results are additionally filtered client-side to the current repository via each result's `repository` field — the standard client-side filtering policy applies, including its `count: N of T total` rule with `T` from the filtered set.
Flags: `--state <open|closed|all>` (default open); `--label <name>` (API-supported — comma-separated names); `--limit <n>` (default 30); `--fields <a,b,c>`.
Default output fields (both commands): `number`, `title`, `state`, `author`, `created` — a locator schema; search results are Issue-shaped for both types, and `draft`/`review` parity with `pr list` would require two extra fetches per result for a command whose job is finding the number to feed into `issue view` / `pr view`.
Output blocks: `issues:` / `pull_requests:`, matching the list commands.
Empty state: standard `<noun>[0]: (none)`.

#### Setup Command

**`setup`**
Installs the bundled Agent Skill markdown into `~/.claude/skills/` (see ADR 0009).
The skill is a minimal pointer, not a command reference: its frontmatter description triggers on Gitea issue/PR/label work; its body says when to use gitea-axi (over tea, raw API calls, or git), lists the command groups with one-line summaries, and points at the bare `gitea-axi` dashboard and per-command `--help` for discovery — the CLI remains the single source of interface truth.
This is gitea-axi's primary fulfillment of AXI Principle 7 (Ambient context): an explicit setup command, matching gh-axi's `setup`.
Idempotent: re-running reports already-installed/updated rather than failing.
Output: `setup: { skill, path, status: <installed|updated|unchanged> }`.

**`setup hooks`**
Opt-in: installs a SessionStart hook via axi-sdk-js's `installSessionStartHooks()` into Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/hooks.json` plus `config.toml`), and OpenCode (ambient plugin) — see ADR 0009.
The hook runs the bare `gitea-axi` binary (the short dashboard tier) in the session's working directory at session start and injects its output as ambient context.
Idempotent: managed entries are updated in place by the SDK.
Output mirrors gh-axi: `hooks: { status: installed, integrations: Claude Code, Codex, OpenCode }`, with a help line to restart the agent session.

#### Shadowed Built-in Commands

`update` — axi-sdk-js ships a built-in self-update command (checks npmjs.org and updates the install) with its own `UPDATE_ERROR` code; gitea-axi shadows it (see ADR 0013).
`gitea-axi update` fails with `VALIDATION_ERROR` and a help line: `` Run `npm install -g gitea-axi@latest` to update ``.
This keeps the command surface and the ten-code error list exactly as specified here.

### Name-to-ID Resolution

Some Gitea API endpoints require integer IDs where gitea-axi accepts human-readable names.

**Milestone names** (`--milestone <name>` on `issue create`, `issue edit`, `pr create`, `pr edit`):
Resolved via `GET /repos/{owner}/{repo}/milestones?name=<name>`.
`VALIDATION_ERROR` if no milestone with that name exists.

**Label names for `pr list --label`**:
Resolved via `GET /repos/{owner}/{repo}/labels`, matched case-insensitively.
`VALIDATION_ERROR` if not found.
`--label-id <id>` bypasses this lookup.

**Label names for `issue create` and `pr create` (`--label <name>`)**:
Same case-insensitive label lookup.
`VALIDATION_ERROR` if not found.

**Label names for `issue edit` / `pr edit` `--add-label`**:
Not resolved — the label name is passed directly in the POST body; Gitea's label endpoint accepts names.

**Label names for `issue edit` / `pr edit` `--remove-label`**:
Resolved via case-insensitive label lookup.
`VALIDATION_ERROR` if the label name does not exist in the repo.
If the label exists but is not applied to the issue/PR, Gitea's 404 on `DELETE /labels/{id}` is treated as silent success.

**Label names for `label edit <name>` / `label delete <name>`**:
Resolved via the same case-insensitive label lookup.
`VALIDATION_ERROR` if not found.

### Client-Side Filtering Policy

When a filter flag has no corresponding Gitea API query parameter, gitea-axi paginates all results (`limit=50` per page until exhausted) and filters in-process (see ADR 0005).
Known client-side filters for the current surface: `pr list --assignee`, `pr list --base`, `pr list --head`, `pr list --draft`.
When any client-side filter is active, the count line shows `count: N of T total`, where `T` is the true filtered total computed from the in-memory result set; the `X-Total-Count` header (which reflects the unfiltered total) is ignored as misleading.
Client-side *sort* (`issue list --sort`) is not a filter: it reorders without changing membership, so `T` comes from the `X-Total-Count` header as usual; full pagination still precedes sorting.

### Issue/PR Type Guard

Gitea's issue endpoints also serve pull requests (`Issue.pull_request` is non-null for PRs).
Every issues-list call passes `type=issues` — `issue list`, the dashboard's issue aggregation, and any client-side-filter pagination.
Issue commands invoked with a PR number fail with `VALIDATION_ERROR` ("issue #N is a pull request") and a `pr view <n>` help line, detected via the fetched object's `pull_request` field.
Exception: `issue comment` stays permissive — PRs genuinely share the comment endpoint.

### reviewDecision Computation

Gitea has no aggregated `reviewDecision` field on the PR object.
gitea-axi computes it client-side from the reviews list (see ADR 0006).
Scope (official-first fallback): if any review on the PR carries `official=true`, only official reviews are considered (branch-protection semantics preserved); otherwise all reviews are considered — unprotected repos never produce official reviews, so without the fallback `APPROVED` would be unreachable there.
Logic within the considered set: `CHANGES_REQUESTED` if any non-dismissed `REQUEST_CHANGES` exists; `APPROVED` if at least one review with state `APPROVED` has `stale=false` and `dismissed=false`; `REVIEW_REQUIRED` otherwise.
The otherwise-bucket includes zero-review PRs and comment-only reviews: it renders as `required`, meaning "no conclusive review yet".
There is no `none` value — a deliberate three-value departure from gh-axi's four-value mapping, since Gitea offers no non-admin way to detect whether branch protection formally requires review.
On `pr list`, reviews for each PR are fetched in parallel (one extra HTTP call per PR in the list).

### Context Override Flags

gitea-axi accepts two top-level context override flags and two matching environment variables, mirroring gh-axi's design (`GH_REPO`):

- `-R` / `--repo <OWNER/NAME>` — overrides the repository detected from the git remote; env equivalent `GITEA_AXI_REPO`.
- `--login <name>` — selects a specific tea login profile, overriding the one matched from the git remote's hostname; env equivalent `GITEA_AXI_LOGIN`.

Resolution priority: flag > environment variable > auto-detection (git remote / hostname match).
Both flags are accepted anywhere on the command line, before or after the command — more permissive than gh-axi, which rejects them before the command; next-step suggestions always render them after the command.
These overrides are injected into next-step suggestions only when the context came from a flag or environment variable, not when it was auto-detected from the git remote (because the agent's next call will be in the same working directory and will auto-detect the same context).

### Output — The 10 AXI Principles

**Principle 1 — TOON output.**
All structured output uses the `@toon-format/toon` `encode()` function, wrapped in `renderList()` and `renderDetail()` helpers that handle the list/detail shape distinction.

**Principle 2 — Minimal default schemas.**
Each command exposes a small default field set (5–6 fields per list row), enumerated per command in the Command Surface section.
This is a deliberate, documented departure from the canonical 3–4-field guidance: each extra field (`state`, `created`, `draft`, `review`) answers a routine triage question that would otherwise cost a follow-up call.
Additional fields are opt-in via `--fields`.
Field extraction uses a `FieldDef` type system with typed extractors: nested pluck, array join, enum map, bool-to-text, and relative time formatting — matching gh-axi's internal architecture.

**Principle 3 — Content truncation.**
Body text is truncated at **500 characters** in all contexts (list and detail alike), matching gh-axi.
Comment bodies truncate at 800 characters wherever they appear (comment-post output and `--comments` view blocks), with cleanBody applied.
Diff content is truncated at 4000 characters.
When body truncation occurs, a hint is appended inline: `"... (truncated, N chars total - use --full to see complete body)"`.
When diff truncation occurs, `truncated: true` and `original_length: N` are added as separate fields, and a next-step suggestion to use `--full` is prepended.
`--full` on `issue view` and `pr view` suppresses all truncation in the command's output (entity body and comment bodies alike); `--full` on `pr diff` suppresses diff truncation.
Before truncation, a `cleanBody` step is applied **only when the raw body exceeds the truncation limit**.
`cleanBody` normalizes Gitea issue/PR URLs using the detected hostname (`https://<host>/<owner>/<repo>/issues/N` → `Issue#N`; `.../pulls/N` → `PR#N`), strips markdown image embeds, removes long URLs in markdown links and standalone text, and collapses email-style quoted blocks — matching gh-axi's transforms plus Gitea-specific URL normalization.
If cleaning brings the body within the limit, the cleaned body is returned with an appended note; if it still exceeds the limit, the cleaned body is truncated.

**Principle 4 — Pre-computed aggregates.**
List output leads with a `formatCountLine()`: `"count: N of T total"`, with `T` from the `X-Total-Count` response header, or computed from the in-memory filtered set when a client-side filter is active; `"count: N (showing first N)"` when at the request limit and no total is available.
The bare `count: N` form does not exist — the total is always reported (canonical Principle 4).
Detail output for issues includes `comment_count`; for PRs includes `review_count` and `comment_count`.
The review decision (`review` field) is a default on `pr list` and the dashboard PR table, computed client-side from parallel review fetches.
The full-tier dashboard's issue-by-label counts are computed by fetching all pages of open issues and aggregating in-process.
Both `issue comment` and `pr comment` return the created comment object directly from the POST response, eliminating the need for a follow-up view call.

**Principle 5 — Definitive empty states.**
When a list command returns no results it emits `<noun>[0]: (none)` followed by a relevant next-step suggestion.
The dashboard's empty states are `prs: 0 open` / `issues: 0 open` (raw strings, matching gh-axi's home view).
Empty output is never silent.

**Principle 6 — Structured errors, exit codes, idempotent mutations, no prompts.**
Errors are represented as a typed `AxiError` with one of ten named codes: `REPO_NOT_FOUND`, `ISSUE_NOT_FOUND`, `PR_NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`, `TEA_NOT_INSTALLED`, `VALIDATION_ERROR`, `GIT_ERROR`, `UNKNOWN`.
The `ISSUE_NOT_FOUND`/`PR_NOT_FOUND` split (vs gh-axi's single `NOT_FOUND`) is a deliberate divergence enabled by path-based 404 classification.
API error responses are classified by HTTP status code and calling context:

| HTTP status | Context | Error code |
|---|---|---|
| 401 | any | `AUTH_REQUIRED` |
| 403 | any | `FORBIDDEN` |
| 404 | called on `/repos/{owner}/{repo}` itself | `REPO_NOT_FOUND` |
| 404 | called on `/repos/.../issues/{index}` | `ISSUE_NOT_FOUND` |
| 404 | called on `/repos/.../pulls/{index}` | `PR_NOT_FOUND` |
| 404 | other paths | `UNKNOWN` |
| 405 | any | `VALIDATION_ERROR` (body message surfaced — e.g. PR not mergeable due to conflicts or unmet checks; help: `pr update-branch <n>` or `pr checkout <n>` to resolve) |
| 409 | any | `VALIDATION_ERROR` (body message surfaced — e.g. head changed since merge was requested, or auto-merge already scheduled) |
| 422 | any | `VALIDATION_ERROR` (body message surfaced) |
| 429 | any | `RATE_LIMITED` (help: wait and retry, or reduce `--limit`) |
| other | any | `UNKNOWN` |

`TEA_NOT_INSTALLED` is emitted if the tea binary is not found during credential discovery.
Login matching against the detected hostname is a three-way split:
tea installed with zero logins configured → `AUTH_REQUIRED` (the tool was never set up; help: `` Run `tea login add` ``);
tea has logins but none match the detected hostname → `REPO_NOT_FOUND` (the repo is not recognized as belonging to a known Gitea instance — a remote URL's shape cannot reveal Gitea-ness, so an unmatched host most likely means a non-Gitea repo such as a GitHub clone; help: `` Run `tea login add --url <host>` `` if this is a Gitea instance, or pass `-R` + `--login`);
HTTP 401 from the API → `AUTH_REQUIRED` (token invalid or revoked), per the status table.
A `--login` value naming a nonexistent profile is `VALIDATION_ERROR`, listing the available profile names.
`GIT_ERROR` classifies non-zero git subprocess exits (currently only `pr checkout`), carrying git's first stderr line.
Error output is TOON-encoded to stdout (not stderr): `error: <message>`, `code: <CODE>`, and optionally `help[N]:` with suggestion lines.
The suggestions field is named `help`, not `hint`.
Exit codes: 0 success, 1 error, 2 for `VALIDATION_ERROR` — covering unknown flags, missing required inputs, and server-side 422 rejections alike (the `axi-sdk-js` `exitCodeForError` mapping; see ADR 0004).
This deliberately broadens the canonical "exit 2 for unknown flags" wording: exit 2 uniformly means "the input was invalid — fix the call and retry".

Mutations are idempotent, and no command ever prompts:
`pr create` checks for an existing open PR before creating; if one exists, returns its details with `already: true` rather than creating a duplicate.
`issue edit --add-label` / `--remove-label` uses Gitea's dedicated additive label endpoints, which are idempotent.
`issue close`, `issue reopen`, `pr close`, `pr reopen`, `pr merge`, `issue pin`, `issue unpin`, `issue blocks add/remove`, `issue blocked-by add/remove`, and `setup` all check current state before mutating and return early if already in the target state.
Hard deletes (`issue delete`, `label delete`) deliberately refuse missing targets instead of reporting idempotent success (see ADR 0010).
All required inputs are flags — missing ones cause an immediate `error:` exit.

**Principle 7 — Ambient context.**
Fulfilled primarily by the `setup` command, which installs the bundled Agent Skill into `~/.claude/skills/` (see ADR 0009).
The skill surfaces gitea-axi to the agent at session start whenever it is relevant, without a per-session hook cost.
The canonical principle's primary mechanism — SessionStart hooks that inject the dashboard as initial context — is offered as the opt-in `setup hooks`, not the default.
There is no postinstall script — skill and hook installation are always explicit user actions, matching the canonical principle wording ("from an explicit setup command") and gh-axi's own `setup` command.

**Principle 8 — Content first.**
Running `gitea-axi` with no arguments shows live repository state, not a help screen, preceded by the SDK's `bin:` + `description:` header (executable path and one-sentence description, per the canonical principle).
The short tier makes two parallel API calls — 3 open issues, 3 open PRs — plus up to 3 parallel review fetches.
The full tier (`--full`) additionally aggregates open issue counts by label: open issues are paginated with `limit=50` and `type=issues`, up to a hard cap of 1000 issues (20 pages max); if the cap is hit, label counts are suffixed with `+`.
Each issue contributes to all of its labels; unlabeled issues appear as a separate `unlabeled` row only when non-zero.

**Principle 9 — Contextual next-step suggestions.**
Every command appends semi-dynamic suggestions to its output, rendered as a `help[N]:` block — the same block name used for error suggestions, matching gh-axi and the canonical principle text.
Runtime values are hybrid: list output keeps placeholders (`` `gitea-axi issue view <number>` ``) since the agent must choose which result it cares about; single-entity output fills the actual id (`` `gitea-axi issue view 42` ``) since it is unambiguous — matching the canonical "leave runtime values parameterized" guidance while carrying forward known ids.
Every command emits at least one suggestion; there are no empty `help:` blocks (a departure from gh-axi, which omits suggestions on `pr view` and emits empty blocks on `pr checkout`).
Every suggestion auto-includes `-R`/`--repo` and `--login` flags when the context was not auto-detected from the git remote — matching gh-axi's suggestion normalization approach.

**Principle 10 — Consistent `--help`.**
Every subcommand responds to `--help` with a concise flag reference.
Unknown flags exit with code 2.
No subcommand ever prompts interactively.

### Repository Context Detection

Repo owner, name, and hostname are detected from the git `origin` remote URL of the current directory.
Both SSH (`git@host:owner/repo.git`) and HTTPS (`https://host/owner/repo.git`) remote formats are supported.
If no recognizable Gitea remote URL is found on `origin`, gitea-axi exits with `REPO_NOT_FOUND` and a hint to configure the remote.
The detected hostname is used to select the matching tea login profile for auth.

### Distribution

Published to npm as `gitea-axi` (unscoped).
Binary name: `gitea-axi`.
The Agent Skill markdown file is bundled inside the npm package.
There is no postinstall script: `npm install -g gitea-axi` delivers the CLI binary, and a one-time explicit `gitea-axi setup` installs the skill into `~/.claude/skills/` (see ADR 0009).
The dashboard suggestion table hints at `setup` so the skill install is discoverable.

## Testing Decisions

Good tests exercise the actual command-line interface (argv in, stdout/exit-code/stderr out) — the one seam every caller depends on.
They do not test internal functions in isolation, and they do not mock individual API calls in a way that only proves gitea-axi issued the right HTTP request.
Instead, tests verify that gitea-axi correctly reshapes real API responses into correct TOON, correct error lines, and correct exit codes.

**Test seam:** Three environment variables together activate test mode:
- `GITEA_AXI_API_URL` — overrides the API base URL to point at the fixture server; also signals test mode, suppressing both the git remote subprocess and the tea credential subprocess.
- `GITEA_AXI_TOKEN` — supplies the auth token directly, bypassing `tea login list`.
- `GITEA_AXI_REPO` — supplies the repository context as `OWNER/NAME`, equivalent to `-R`; required in test mode since git remote detection is suppressed.

`GITEA_AXI_REPO` and `GITEA_AXI_LOGIN` are general context overrides (see Context Override Flags), not test-mode-specific; test mode merely relies on them.

In tests, `GITEA_AXI_API_URL` points to a local HTTP fixture server that maps incoming request paths and methods to pre-recorded Gitea API JSON response files stored in `fixtures/`.
This means tests exercise the full reshaping pipeline — JSON parse, field extraction, TOON encoding, truncation, suggestion generation, error classification — without a live Gitea instance.

**Two-tier test strategy:**
- Local / unit tier: the fixture server runs fast with no external dependencies.
  Used for all command-level assertions.
- CI integration tier: a live disposable Gitea instance serves real API responses end-to-end, verifying that fixture recordings remain accurate and that the full HTTP pipeline works correctly.
  CI runs on Gitea Actions on `git.alexion.dev` (where the PRs live), with the disposable Gitea as a docker service container pinned to the latest stable image tag, bumped deliberately.
  The workflow file stays GitHub-Actions-compatible so the GitHub mirror can adopt it nearly verbatim later.

**Test runner:** Vitest.

## Out of Scope

- Any workflow-specific commands or hardcoded label/state semantics.
- Inline per-line PR review comments (a possible future addition; the primitive here is a plain PR comment).
- Multi-instance orchestration beyond what `tea`'s own login profiles already provide.
- A repo-level config file for dashboard customization (deferred post-MVP).
- A `dot` or any other host CLI's subcommand wrapping this tool — it is a standalone, independently distributed tool.
- Gitea Projects (kanban boards) — no REST API exists as of gitea-js v1.23.

## Further Notes

- AXI ("Agent eXperience Interface"): https://axi.md/ and https://github.com/kunchenguid/axi.
  Its reference implementation, `gh-axi` (https://github.com/kunchenguid/gh-axi), wraps GitHub's `gh` CLI.
  The canonical principle text is authoritative for gitea-axi; gh-axi is a non-binding shape reference.
  gitea-axi adopts gh-axi's `FieldDef` type system, `renderList()`/`renderDetail()` output helpers, typed `AxiError` classification, and suggestion normalization, and documents each deliberate departure in place.
- TOON format spec: https://toonformat.dev/.
  The official TypeScript library is `@toon-format/toon`; no Go library exists, which was a decisive factor in the TypeScript language choice.
- `gitea-js` is the official TypeScript client for the Gitea API, generated from Gitea's OpenAPI spec.
  It is the sole HTTP layer; no raw `fetch` calls are made outside of it.
- Tea's login store (`~/.config/tea/config.yml`) is read indirectly via `tea login list --output json`.
  gitea-axi does not parse the YAML config file directly, to avoid coupling to tea's internal storage format.
- Tea was evaluated as the primary implementation strategy (subprocess wrapping with `--output json`) and rejected — see ADR 0002.
  Tea improvements relevant to the gaps found (JSON output on create commands, non-interactive comment expansion) may be contributed upstream as separate PRs.
- The Gitea Go SDK (`gitea.dev/sdk`) was evaluated as an alternative to `gitea-js`.
  It was rejected because it requires Go compilation, adding cross-compilation complexity for npm distribution.
- `gitea-axi` is unclaimed on npm and GitHub as of 2026-07-09.
- Developed against the operator's personal Gitea instance at `git.alexion.dev`; push-mirrored to GitHub for npm publishing and public discoverability.
