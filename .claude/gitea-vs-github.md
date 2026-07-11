# Gitea vs GitHub: API Feature Comparison for CLI Agent Tooling

Focus: features relevant to `gitea-axi` — issues, pull requests, labels, reviews, comments, auth, and API mechanics.
Sources: Gitea OpenAPI spec (docs.gitea.com/api/1.21), GitHub REST docs, Gitea source structs (`modules/structs/`).

---

## API Style

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| REST API | Yes — `/api/v1` (actually `/repos/...` at api.github.com) | Yes — `/api/v1/repos/...` | Gitea mirrors GitHub's path structure closely |
| GraphQL API | Yes — `api.github.com/graphql` | **No** | Gitea is REST-only; no GraphQL endpoint exists |
| OpenAPI spec | Unofficial/community | Yes — `/api/swagger` on every instance | Gitea ships a first-class Swagger UI and JSON spec |
| TypeScript client | `@octokit/rest` (hand-written) | `gitea-js` (generated from OpenAPI) | `gitea-js` types are auto-generated and stay in sync with the spec |
| API versioning | `api-version` header (`2026-03-10`) | Path-prefixed (`/api/v1`) | GitHub uses a header; Gitea uses path versioning |

---

## Authentication

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Personal access tokens (classic) | Yes — broad scope-based | Yes — scope-based (`read:issue`, `write:repository`, etc.) | Gitea scopes map to API route groups |
| Fine-grained PATs | Yes — per-repo permissions, expiry required | **No** — scopes are coarser (category-level, not per-repo) | GitHub fine-grained tokens are more restrictive by default |
| Token creation via API | No (web only for fine-grained) | **Yes** — `POST /user/tokens` | Gitea allows programmatic token creation with BasicAuth |
| Token listing/deletion via API | No | **Yes** — `GET /user/tokens`, `DELETE /user/tokens/{id}` | Gitea exposes full token lifecycle over the API |
| OAuth App device flow | **Yes** | **No** — only Authorization Code (+ PKCE) | GitHub device flow is essential for headless CLI auth; Gitea lacks it |
| OAuth App web flow | Yes | Yes | Both support standard Authorization Code grant |
| OAuth App management via API | No | **Yes** — `GET/POST/PATCH/DELETE /user/applications/oauth2` | Gitea lets users manage their own OAuth apps via API |
| GitHub Apps / installation tokens | Yes | **No** — no GitHub Apps concept | Gitea has no equivalent of GitHub Apps or installation tokens |
| `GITHUB_TOKEN` in Actions | Yes | No (`GITEA_TOKEN` in Gitea Actions is similar but not identical) | Gitea Actions has a built-in `GITEA_TOKEN` but it is instance-specific |
| HTTP Signatures (SSH key auth) | No | **Yes** | Gitea accepts signatures per draft-cavage-http-signatures |
| Basic auth | Deprecated/removed | Yes (for token creation only; not recommended for general use) | |
| Sudo (act-as) | No | **Yes** — `?sudo=username` for admins | Admin-only; useful for automation |
| SAML SSO token authorization | Yes (org-enforced) | No | Gitea has no SAML SSO concept |

---

## Pagination

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Offset/page pagination | Yes — `?page=N&per_page=N` (max 100) | Yes — `?page=N&limit=N` | Same concept; parameter names differ (`per_page` vs `limit`) |
| Cursor-based pagination | Some endpoints (`before`/`after`) | **No** | Gitea is page-offset only |
| `Link` header (RFC 5988) | **Yes** — `next`, `prev`, `last`, `first` | **Yes** — same format | Both provide `Link` headers for navigation |
| `X-Total-Count` response header | **No** | **Yes** | Gitea returns total count in every list response; GitHub does not |
| `x-total-count` in `gitea-js` | n/a | Available as a parsed header | The `gitea-js` client exposes this alongside the response body |
| Maximum per-page results | 100 | Configurable (instance default ~50, max configurable) | Gitea's max is admin-controlled; no hard 100 cap in the API |

---

## Rate Limiting

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Per-user rate limit | 5,000 req/hr (authenticated) | **No standard rate limiting** | Gitea uses QoS concurrency throttling, not per-user counters |
| `X-RateLimit-*` headers | Yes — `Limit`, `Remaining`, `Used`, `Reset` | **No** | Gitea does not emit rate-limit headers |
| Secondary limits | Yes (content creation, concurrency) | No | |
| QoS / overload protection | No | **Yes** — configurable `[qos]` section | Gitea drops or queues requests under load rather than rate-limiting |

---

## Issue Management

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Create issue | Yes — `POST /repos/{owner}/{repo}/issues` | Yes — same path pattern | |
| List issues | Yes | Yes | |
| Get single issue | Yes | Yes | |
| Edit issue | Yes | Yes | |
| Delete issue | **No** (close only) | **Yes** — `DELETE /repos/{owner}/{repo}/issues/{index}` | Gitea allows hard deletion |
| Issue state | `open` / `closed` | `open` / `closed` | Same values |
| `state_reason` | **Yes** — `completed`, `not_planned`, `duplicate`, `reopened` | **No** | Gitea has no close-reason concept |
| Issue type | **Yes** — first-class `type` field on create/edit | **No** | GitHub supports issue type classification; Gitea does not |
| `duplicate_issue_id` | **Yes** | **No** | |
| Issue dependencies (blocking) | No (sub-issue relationships only) | **Yes** — `POST /repos/{owner}/{repo}/issues/{index}/dependencies` | Gitea has explicit blocking/blocked-by relationships between issues |
| Issue blocking list | No | **Yes** — `GET /repos/{owner}/{repo}/issues/{index}/blocked-by` | |
| Pin issue | Partial (read-only in API response) | **Yes** — `POST/DELETE /repos/{owner}/{repo}/issues/{index}/pin`, position reorder | Gitea has full pin CRUD including ordering |
| Issue timeline | Yes — 30+ event types (labels, assignments, reviews, etc.) | Yes — `GET /repos/{owner}/{repo}/issues/{index}/timeline` (comments + events) | GitHub's timeline is richer in event type variety |
| Reactions on issues | Yes — 8 types | Yes — same types | |
| Reactions on issue comments | Yes | Yes | |
| Lock/unlock conversation | Yes — with `lock_reason` (`off-topic`, `too heated`, `resolved`, `spam`) | **No** — issues have `IsLocked` field but no dedicated lock endpoint visible | |
| Subscriptions (watching) | Via notifications API | **Yes** — explicit `PUT/DELETE /repos/{owner}/{repo}/issues/{index}/subscriptions` | Gitea exposes subscribe/unsubscribe directly on issues |
| Issue search (cross-repo) | Yes — `GET /search/issues` with qualifiers | Yes — `GET /issues/search` | Both support cross-repo search |
| Custom field values | **Yes** (org repos) | **No** | GitHub-specific feature |
| Time tracking (estimate) | No | **Yes** — `TimeEstimate` field on Issue struct | Gitea has built-in time tracking |
| Content versioning (conflict detect) | No | **Yes** — `ContentVersion` field on create/edit | Gitea supports optimistic locking for concurrent edits |
| Original author tracking (migrations) | No | **Yes** — `OriginalAuthor` / `OriginalAuthorID` fields | Preserved when importing from other platforms |
| Issue `Ref` field | No | **Yes** — git ref associated with issue | |

---

## Milestones

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Milestone CRUD | Yes — `GET/POST/PATCH/DELETE /repos/{owner}/{repo}/milestones` | Yes — same path pattern | |
| Milestone on issues | Yes | Yes | |
| Milestone on PRs | Yes | Yes — `milestone` field in `CreatePullRequestOption` and `EditPullRequestOption` | |
| Milestone properties | `title`, `description`, `state`, `due_on` | Same | |
| Org-level milestones | No | No | Neither supports org-level milestones |

---

## Label Management

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Repo label CRUD | Yes — `GET/POST/PATCH/DELETE /repos/{owner}/{repo}/labels` | Yes — same path pattern | |
| Org-level labels | No | **Yes** — `GET/POST/PATCH/DELETE /orgs/{org}/labels` | Gitea supports organization-scoped labels |
| Label properties | `name`, `color`, `description` | `name`, `color`, `description` | |
| Add/remove labels on issue | Yes | Yes | |
| Add/remove labels on PR | Yes | Yes | |
| Replace all labels | Yes | Yes | |

---

## Pull Request Management

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| Create PR | Yes | Yes | |
| List PRs | Yes | Yes | |
| Get PR | Yes | Yes | |
| Edit PR | Yes | Yes | |
| Delete PR | No | No | Neither allows hard deletion |
| Draft PRs | **Yes** — `draft: true` on create | **Yes** — `Draft bool` field | Both support drafts |
| Draft PR filter in list | Yes | Yes — `draft` query param available | |
| `maintainer_can_modify` | Yes | **Yes** — `AllowMaintainerEdit` field | Same concept, different name |
| `ContentVersion` conflict detection | No | **Yes** | Same optimistic-locking field as issues |
| Pin PR | No | **Yes** — same pin endpoints as issues, `PinOrder` field | |
| Get PR diff | Yes — `Accept: application/vnd.github.diff` | **Yes** — `GET /repos/{owner}/{repo}/pulls/{index}/diff` | Gitea returns raw diff text |
| Get PR patch | Yes — `Accept: application/vnd.github.patch` | Yes — `GET /repos/{owner}/{repo}/pulls/{index}/diff` with format param | |
| List PR files (structured) | Yes — `GET /pulls/{number}/files` | **Yes** — `GET /repos/{owner}/{repo}/pulls/{index}/files` | Returns file list with additions/deletions |
| List PR commits | Yes | **Yes** — `GET /repos/{owner}/{repo}/pulls/{index}/commits` | |
| Mergeable status | Yes — `mergeable` field | **Yes** — `Mergeable bool` field on PR | |
| Merge strategies | merge, squash, rebase | merge, squash, rebase, **rebase-merge** (rebase + no-ff), **fast-forward-only** | **Gitea has more merge strategies** |
| Squash merge | Yes | Yes | |
| Rebase merge | Yes | Yes | |
| Fast-forward-only | No | **Yes** | |
| Rebase + explicit merge commit | No | **Yes** — `rebase-merge` style | |
| Auto-merge (merge when checks pass) | Yes | **Yes** — `MergeWhenChecksSucceed` field | Both support scheduling a merge after CI passes |
| Cancel auto-merge | Yes | Yes — `DELETE /repos/{owner}/{repo}/pulls/{index}/merge` | |
| Delete branch after merge | Yes | **Yes** — `DeleteBranchAfterMerge` field on merge request | |
| Force merge | Limited (bypass protections with permissions) | **Yes** — `ForceMerge bool` field | Gitea has an explicit force-merge flag |
| Manually merged (mark as merged) | No | **Yes** — `Do: "manually-merged"` + `MergeCommitID` field | Gitea allows recording a manual merge after the fact |
| `HeadCommitSHA` validation on merge | No | **Yes** — `HeadCommitID` field for merge safety | |
| PR merge commit message/title | Yes — `commit_title`, `commit_message` | **Yes** — `MergeTitleField`, `MergeMessageField` | |
| Pinned PRs list | No | **Yes** — `GET /repos/{owner}/{repo}/pulls/pinned` | |

---

## Review Management

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| List reviews | Yes | Yes | |
| Create review | Yes | Yes | |
| Submit pending review | Yes | Yes | |
| Delete pending review | Yes | Yes | |
| Dismiss review | Yes — `POST /pulls/{number}/reviews/{id}/dismissals` | **Yes** — `POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/dismiss` | |
| Un-dismiss review | No | **Yes** — `POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/undismiss` | Gitea allows undoing a dismissal |
| Review states | `APPROVED`, `REQUEST_CHANGES`, `COMMENT`, `PENDING`, `DISMISSED` | `APPROVED`, `REQUEST_CHANGES`, `COMMENT`, `PENDING`, (+ `REQUEST_REVIEW`) | States match; Gitea adds `REQUEST_REVIEW` as a state type |
| `DISMISSED` state | Yes — set by dismiss action | Yes — `Dismissed bool` + `Stale bool` fields | |
| Aggregated `reviewDecision` field | **Yes (GraphQL only)** — `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` | **No** | Gitea has no single aggregated review decision; must be computed from individual reviews |
| `reviewDecision` via REST | No (GitHub REST also lacks this) | No | Both REST APIs require client-side aggregation |
| Official/required review flag | No | **Yes** — `Official bool` field on review | Gitea marks reviews from required reviewers as official |
| `Stale` review flag | No | **Yes** — `Stale bool` field | Gitea marks reviews stale when new commits are pushed |
| Review request (users) | Yes — `POST /pulls/{number}/requested_reviewers` | **Yes** — `POST /repos/{owner}/{repo}/pulls/{index}/requested_reviewers` | |
| Review request (teams) | Yes — `team_reviewers` param | **Yes** — `TeamReviewers` param | |
| Remove review request | Yes | Yes | |
| List eligible reviewers | No (must list repo collaborators separately) | **Yes** — `GET /repos/{owner}/{repo}/pulls/{index}/requested_reviewers` returns all eligible users | Gitea returns who *can* be requested, not just who has been |
| Inline code comments on review | Yes — with line, side, path, start_line | **Yes** — `CreatePullReviewComment` struct with position/path | |
| Multi-line comment range | Yes — `start_line`/`start_side` + `line`/`side` | Partial — position-based rather than line-range | GitHub's multi-line range is more explicit |
| Reply to review comment | Yes — `POST /pulls/{number}/comments/{id}/replies` | Yes — reply via in_reply_to reference | |
| List review comments (inline) | Yes | Yes | |
| Edit/delete review comment | Yes | Yes | |
| Reactions on review comments | Yes | **No** — reactions are on issue comments only, not PR review comments | Gitea's reaction support does not extend to PR review comments |
| `commitId` on review | Yes | **Yes** — `CommitID` field | |

---

## Issue & PR Comments

| Feature | GitHub | Gitea | Notes |
|---|---|---|---|
| List issue comments | Yes | Yes | |
| Create issue comment | Yes | Yes | |
| Edit comment | Yes | Yes | |
| Delete comment | Yes | Yes | |
| Pin/unpin comment | **Yes** — `PUT/DELETE /issues/comments/{id}/pin` | No | GitHub supports pinned comments on issues |
| Reactions on issue comments | Yes — 8 types | **Yes** — same 8 types | |
| Reactions on PR review comments | Yes | **No** | Gap in Gitea: review comment reactions not supported |
| `body_html` / `body_text` fields | Yes | No — body is Markdown only | GitHub returns rendered HTML variants |
| `author_association` field | Yes | No | GitHub classifies commenter relationship to repo |

---

## Summary: Key Gaps and Gitea Advantages

### Gitea lacks (compared to GitHub)

| Missing in Gitea | Impact on CLI tooling |
|---|---|
| No GraphQL API | Cannot get aggregated `reviewDecision`; must compute from review list |
| No `reviewDecision` enum (REST or GraphQL) | CLI must fold `APPROVED`/`REQUEST_CHANGES` reviews client-side |
| No device flow OAuth | Headless login requires PAT or BasicAuth; cannot do browser-less OAuth |
| No `state_reason` on issues | Cannot distinguish "completed" vs "not planned" close reasons |
| No issue type (bug/feature classification) | Labels must substitute for issue type |
| No fine-grained per-repo PATs | Tokens are category-scoped, not repo-scoped |
| No `X-RateLimit-*` headers | Cannot back off gracefully on rate limits (no limit signal) |
| No cursor-based pagination | Must use offset pagination; large result sets may drift |
| No `body_html` on comments | Must render Markdown client-side if HTML is needed |
| No `author_association` | Cannot determine contributor relationship without separate lookup |
| No reactions on PR review comments | Review comment reactions not possible |
| No lock/unlock issue endpoint | Issue locking is not exposed as an API operation |
| No GitHub Apps / installation tokens | Cannot use app-level auth scoping |

### Gitea advantages (compared to GitHub REST)

| Gitea-only capability | Impact on CLI tooling |
|---|---|
| `X-Total-Count` response header | Accurate totals on every list response; no extra count query needed |
| Token CRUD via API | Programmatic token management without web UI |
| OAuth app management via API | Automation-friendly app registration |
| Hard delete issues | Useful for cleanup automation |
| Issue dependencies (blocking/blocked-by) | Richer workflow modelling |
| Issue pinning with position reorder | Full pin management via API |
| Issue subscriptions endpoint | Subscribe/unsubscribe without using notifications API |
| Org-level labels | Labels shared across all org repos |
| `Official` + `Stale` flags on reviews | Richer review state without client-side inference |
| `Undismiss` review endpoint | Reversible review dismissals |
| Eligible reviewer list on PR | Know who *can* review before requesting |
| `ForceMerge` flag | Explicit force-merge without separate branch protection bypass |
| `manually-merged` merge style | Record out-of-band merges |
| `rebase-merge` + `fast-forward-only` styles | More granular merge strategy control |
| `ContentVersion` on issues and PRs | Optimistic locking for concurrent edits |
| Time tracking (`TimeEstimate`) | Built-in estimation without third-party integrations |
| `Sudo` param (admin) | Act-as for admin automation |
| HTTP Signature auth | SSH key based API auth |
| `PinOrder` on PRs | PRs can also be pinned, not just issues |
