# gitea-axi

A thin TypeScript CLI that calls the Gitea REST API directly via `gitea-js` to give coding agents an ergonomic, low-token interface to Gitea issues and pull requests.

## Language

### The tool and its host

**gitea-axi**: The CLI tool defined by this project.
_Avoid_: wrapper, adapter, shim

**tea**: The official Gitea CLI whose login store gitea-axi reads for credential discovery; not used for command dispatch.
_Avoid_: Gitea CLI, upstream binary

**gitea-js**: The official TypeScript client for the Gitea REST API, generated from Gitea's OpenAPI spec; the sole HTTP layer in gitea-axi.
_Avoid_: API client, HTTP client, fetch wrapper

**AXI (Agent eXperience Interface)**: The set of 10 design principles that govern how gitea-axi shapes its output and behavior for coding agents.
_Avoid_: agent interface, UX principles

**axi-sdk-js**: The shared TypeScript framework package (`axi-sdk-js` on npm) that provides `runAxiCli`, `AxiError`, `exitCodeForError`, and output helpers; gitea-axi is built on it, matching gh-axi's architecture.
_Avoid_: AXI library, SDK

### Output

**TOON**: The structured text output format used for all gitea-axi output, encoded via `@toon-format/toon`.
_Avoid_: JSON output, structured output

**renderList**: The output helper that formats a collection of entities as a TOON list, preceded by a count line.
_Avoid_: list formatter, table renderer

**dashboard**: The output of `gitea-axi` with no arguments; a two-tier home view preceded by the `bin:` + `description:` header from `axi-sdk-js`.
The short tier (no flags, and what the [[SessionStart hook]] runs) matches gh-axi's home shape: up to 3 open issues (`number`, `title`, `state`, `author`) and up to 3 open PRs (`number`, `title`, `author`, `review`), plus a `help:` hint pointing at `--full`.
The full tier (`gitea-axi --full`) shows open PRs as a TOON table and open issue counts grouped by label.
Issue counts are aggregated by fetching all open issues up to a hard cap of 1000 (page size 50, 20 pages max); if capped, the count is suffixed with `+`.
Each issue contributes to all of its labels; unlabeled issues appear as a separate `unlabeled` row only when non-zero.
Full-tier PR table default fields: `number`, `title`, `author` (plucked from `user.login`), `labels` (joined label names), `review` (computed client-side, same parallel review fetch as `pr list`).
The full-tier PR table is capped at 20 rows with a standard count line (`count: 20 of T total`).
Block names: `repo:` line, then `prs:` and `issues:`.
Empty states (both tiers): `prs: 0 open` / `issues: 0 open` (raw strings, matching gh-axi's home; list commands keep `<noun>[0]: (none)`).
Outside a recognizable Gitea repo the dashboard errors with `REPO_NOT_FOUND` (help: use `-R` + `--login`) — login selection needs a hostname; the resulting hook noise in non-Gitea sessions is an accepted consequence.
_Avoid_: home view, status view

**renderDetail**: The output helper that formats a single entity's full detail as a TOON record.
_Avoid_: detail formatter, record renderer

**count line**: The leading line in list output that states how many results were returned and their relationship to the total, e.g. `count: N of T total`.
When a client-side filter is active, `T` is the true filtered total computed from the in-memory result set (the `X-Total-Count` header, which reflects the unfiltered total, is ignored); the bare `count: N` form does not exist.
_Avoid_: summary line, header

**FieldDef**: A typed descriptor that extracts and formats a single field from raw Gitea API JSON, with named extractor variants (nested pluck, array join, enum map, bool-to-text, relative time).
_Avoid_: field extractor, field descriptor

**content truncation**: Shortening body or diff text to a defined character limit and appending an inline hint — `"... (truncated, N chars total - use --full to see complete body)"` — directly into the field value.
The full content is never written to a temp file; `--full` on the relevant subcommand suppresses *all* truncation in that command's output (entity body and comment bodies alike) and returns raw values instead.
Comment bodies truncate at 800 chars wherever they appear (comment-post output and `--comments` view blocks), with cleanBody applied; `--comments` renders all comments with no count cap, matching gh-axi.
_Avoid_: truncation, clipping, temp-file approach

**cleanBody**: A preprocessing step applied to body text before truncation, to reduce token cost.
Applied only when the raw body exceeds the truncation limit.
Normalizes Gitea issue/PR URLs (using the detected hostname) to compact form: `https://<host>/<owner>/<repo>/issues/N` → `Issue#N`, `https://<host>/<owner>/<repo>/pulls/N` → `PR#N`.
Also strips markdown image embeds, long URLs in markdown links, standalone long URLs, and collapses email-style quoted blocks — matching gh-axi's cleanBody transformations.
_Avoid_: body cleaning, URL normalization

### Errors and suggestions

**AxiError**: The typed error value with one of ten named codes that gitea-axi emits on failure (TOON-encoded to stdout).
The codes: `REPO_NOT_FOUND`, `ISSUE_NOT_FOUND`, `PR_NOT_FOUND`, `AUTH_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`, `TEA_NOT_INSTALLED`, `VALIDATION_ERROR`, `GIT_ERROR`, `UNKNOWN`.
`GIT_ERROR` classifies non-zero git subprocess exits (currently only `pr checkout`), carrying git's first stderr line — the agent's recovery is local (fix the worktree), unlike API errors.
The `ISSUE_NOT_FOUND`/`PR_NOT_FOUND` split (vs gh-axi's single `NOT_FOUND`) is a deliberate divergence enabled by path-based 404 classification; `RATE_LIMITED` maps HTTP 429 from proxies in front of Gitea.
_Avoid_: error object, exception

**next-step suggestion**: A semi-dynamic hint appended to command output that tells the agent what to call next, normalized to include the current repo context flags.
Rendered as a `help[N]:` block — the same block name used for error suggestions, matching gh-axi and canonical AXI Principle 9.
Runtime values are hybrid: list output keeps placeholders (`issue view <number>`), single-entity output fills the actual id (`issue view 42`), matching canonical Principle 9 ("leave runtime values parameterized") and gh-axi.
_Avoid_: hint, tip, recommendation, next[]

**suggestion normalization**: The process of rewriting a next-step suggestion to include `-R OWNER/NAME` and `--login` flags derived from the current repository context.
Only applied when the context did not come from the git remote (i.e., when `source` is `"flag"` or `"env"`).
_Avoid_: flag injection, context enrichment

### Commands

**issue blocks**: A Gitea-specific subcommand group for managing which issues this issue blocks.
Three sub-operations: `list <n>` (issues blocked by n), `add <n> <target>` (make n block target), `remove <n> <target>`.
Idempotent: `add` of an existing relationship returns `already: true` (fetch-first check); `remove` of a nonexistent relationship is silent success; true validation failures (self-reference, cycles) still surface as `VALIDATION_ERROR`.
No gh-axi equivalent — Gitea-specific API (`/issues/{index}/blocks`).
_Avoid_: blocking, blocks list

**issue blocked-by**: A Gitea-specific subcommand group for managing which issues block this issue (i.e., must be resolved before this one).
Three sub-operations: `list <n>`, `add <n> <blocker>`, `remove <n> <blocker>`.
Same idempotency rules as [[issue blocks]].
No gh-axi equivalent — Gitea-specific API (`/issues/{index}/dependencies`).
_Avoid_: depends, depends-on, dependencies

### Gitea API patterns

**type guard**: The defense against Gitea's unified issue/PR model, where issue endpoints also serve PRs.
Every issues-list call passes `type=issues` (issue list, dashboard aggregation, client-side-filter pagination).
Issue commands invoked with a PR number refuse with `VALIDATION_ERROR` ("issue #N is a pull request") and a `pr view` help line, detected via the fetched object's non-null `pull_request` field.
Exception: `issue comment` stays permissive — PRs genuinely share the comment endpoint.
_Avoid_: PR filtering, issue-only mode

**reviewDecision**: A computed field (not returned by Gitea) that summarizes the overall review state of a PR.
Derived client-side from the reviews list: `APPROVED` if at least one review has `official=true`, `stale=false`, `dismissed=false`, and no non-dismissed `REQUEST_CHANGES` review exists; `CHANGES_REQUESTED` if any non-dismissed `REQUEST_CHANGES` exists; otherwise `REVIEW_REQUIRED`.
On `pr list`, this requires one extra parallel HTTP call per PR to fetch reviews.
_Avoid_: review status, review aggregate

**commit status**: Gitea's CI/CD state mechanism, attached to a commit SHA via `GET /repos/{owner}/{repo}/commits/{sha}/status`.
The state is one of `pending`, `success`, `error`, `failure`, `warning`, `skipped` (`skipped` exists in modern Gitea; older instances never emit it).
gitea-axi uses this as the equivalent of GitHub Check Runs for `pr checks` and the `checks` field on `pr view`.
Conclusion mapping: `success`→`pass`; `failure`/`error`/`warning`→`fail` (matching Gitea's own `Combine()` logic, which treats `warning` as failure); `skipped`→`skip`; `pending`→`pending`.
_Avoid_: check run, CI status, pipeline status

**fetch-then-patch**: The pattern used for additive or subtractive mutations on list fields (assignees, reviewers) where Gitea's PATCH replaces the entire list rather than adding/removing individual entries.
gitea-axi reads the current list first, computes the desired list, then sends a single PATCH with the full resulting list.
_Avoid_: read-modify-write, merge-then-patch

**client-side filtering**: The policy applied when Gitea's API does not support a given filter parameter.
gitea-axi paginates all results from the API (using `limit=50` pages until exhausted) and filters the full result set in-process.
When any client-side filter is active, the count line emits `count: N of T total` with `T` computed from the in-memory filtered set (the unfiltered `X-Total-Count` header is ignored as misleading).
Client-side *sort* (`issue list --sort`) is not a filter: it reorders without changing membership, so `T` comes from the `X-Total-Count` header as usual, while still requiring full pagination before sorting.
_Avoid_: in-memory filtering, local filtering

**label name lookup**: The process of resolving a `--label <name>` string to a Gitea label ID before calling endpoints that require numeric IDs (e.g. `pr list --label`, `issue list --label`).
Implemented via `GET /repos/{owner}/{repo}/labels`; matched case-insensitively.
`--label-id <id>` is a Gitea-specific shortcut flag that bypasses the lookup and passes the ID directly.
_Avoid_: label resolution, name-to-ID mapping

### Testing

**fixture server**: The local HTTP server used in tests, pointed to by `GITEA_AXI_API_URL`, that maps incoming request paths and methods to pre-recorded Gitea API JSON response files.
_Avoid_: mock server, stub server, fake API

**fixture**: A pre-recorded Gitea API JSON response file stored in `fixtures/` that the fixture server returns for a given request path and method.
_Avoid_: snapshot, recording

**test mode**: Activated when `GITEA_AXI_API_URL` is set.
In test mode: all API calls go to the fixture server; tea subprocess is bypassed (token read from `GITEA_AXI_TOKEN`); git remote detection is suppressed.
Three env vars together make tests fully hermetic: `GITEA_AXI_API_URL`, `GITEA_AXI_TOKEN`, `GITEA_AXI_REPO`.
`GITEA_AXI_REPO` and `GITEA_AXI_LOGIN` are not test-mode-specific — they are general context overrides (priority: flag > env > git remote / hostname match, mirroring gh-axi's `GH_REPO`); test mode merely relies on them.
_Avoid_: mock mode, stub mode

### Distribution

**Agent Skill**: The markdown file bundled inside the npm package and installed to `~/.claude/skills/` by the `setup` command.
_Avoid_: skill file, Claude skill

**setup**: The explicit subcommand that installs the Agent Skill into `~/.claude/skills/`; gitea-axi's primary fulfillment of AXI Principle 7 (Ambient context).
Idempotent: re-running reports already-installed/updated rather than failing.
There is no postinstall script — installation of the skill is always an explicit user action.
`setup hooks` additionally opts into the [[SessionStart hook]].
_Avoid_: postinstall, installer script

**SessionStart hook**: An opt-in ambient-context mechanism installed by `setup hooks` via `axi-sdk-js`'s `installSessionStartHooks()` (Claude Code `settings.json`, Codex `hooks.json`, OpenCode plugin).
It runs the bare `gitea-axi` binary (the short [[dashboard]] tier) in the session's working directory at session start and injects the output into the agent's context.
The SDK's installer registers the binary with no arguments, so the hook always runs the short tier; outside a Gitea repo it produces the dashboard's `REPO_NOT_FOUND` error, an accepted noise trade-off.
_Avoid_: session hook, ambient hook, postinstall hook
