# Gitea REST API Reference

Source: gitea-js v1.23.0 TypeScript declarations (generated from Gitea OpenAPI spec).
Base URL: `https://<host>/api/v1`

---

## Auth

**Header:** `Authorization: token <TOKEN>` — Gitea requires the word `token`, **not** `Bearer`.

**Token format:** SHA1 hash string (40 hex chars), e.g. `9fcb1158165773dd010fca5f0cf7174316c3e37d`.
Returned once on creation via `POST /users/{username}/tokens`; not stored in plain text.

**Token scopes** (Gitea 1.19+): fine-grained scopes like `read:issue`, `write:repository`, etc.
Older tokens have no scopes and are effectively admin-level for the user.

---

## Pagination

All list endpoints use `page` (1-based, default 1) and `limit` (page size).
**Not** `per_page` — GitHub uses `per_page`, Gitea uses `limit`.

**Response header:** `x-total-count` (lowercase) — total item count across all pages.
Also returns a `Link` header with `rel="next"` / `rel="last"` URLs.

---

## Issues

### List Issues
```
GET /repos/{owner}/{repo}/issues
```
| Param | Type | Notes |
|---|---|---|
| `state` | `open\|closed\|all` | default `open` |
| `type` | `issues\|pulls` | filter by type |
| `labels` | string | comma-separated label names |
| `milestones` | string | comma-separated milestone names or IDs |
| `since` | date-time | RFC 3339; updated after |
| `before` | date-time | RFC 3339; updated before |
| `created_by` | string | filter by creator username |
| `assigned_by` | string | filter by assignee username |
| `mentioned_by` | string | filter by mentioned username |
| `page` | int | 1-based |
| `limit` | int | page size |

Returns: `Issue[]`

### Search Issues (cross-repo)
```
GET /repos/issues/search
```
| Param | Type | Notes |
|---|---|---|
| `state` | `open\|closed\|all` | default `open` |
| `type` | `issues\|pulls` | |
| `labels` | string | comma-separated |
| `milestones` | string | comma-separated |
| `q` | string | search string |
| `priority_repo_id` | int64 | repo ID to rank higher |
| `since` / `before` | date-time | |
| `assigned` | bool | assigned to authed user |
| `created` | bool | created by authed user |
| `mentioned` | bool | mentioning authed user |
| `review_requested` | bool | review requested from authed user |
| `reviewed` | bool | reviewed by authed user |
| `owner` | string | filter by repo owner |
| `team` | string | requires `owner` |
| `page` / `limit` | int | |

Returns: `Issue[]`

### Get Issue
```
GET /repos/{owner}/{repo}/issues/{index}
```
Returns: `Issue`

### Create Issue
```
POST /repos/{owner}/{repo}/issues
```
Body: `CreateIssueOption`

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | |
| `body` | string | no | |
| `assignees` | string[] | no | usernames |
| `assignee` | string | no | deprecated, use `assignees` |
| `milestone` | int64 | no | milestone ID |
| `labels` | number[] | no | label IDs |
| `due_date` | date-time | no | only date part used |
| `closed` | bool | no | create already-closed |
| `ref` | string | no | branch/commit ref |

Returns: `Issue` (HTTP 201)

### Edit Issue (close/reopen/update)
```
PATCH /repos/{owner}/{repo}/issues/{index}
```
Body: `EditIssueOption`

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `body` | string | |
| `state` | string | `"open"` or `"closed"` — this is how you close/reopen |
| `assignees` | string[] | replaces all assignees |
| `assignee` | string | deprecated |
| `milestone` | int64 | milestone ID (0 to clear) |
| `due_date` | date-time | |
| `unset_due_date` | bool | set true to clear deadline |
| `ref` | string | |

Returns: `Issue`

### Delete Issue
```
DELETE /repos/{owner}/{repo}/issues/{index}
```
Returns: HTTP 204 (requires admin/owner)

### Pin / Unpin Issue
```
POST   /repos/{owner}/{repo}/issues/{index}/pin
DELETE /repos/{owner}/{repo}/issues/{index}/pin
```
No body. Returns: HTTP 204

### Move Pin Position
```
PATCH /repos/{owner}/{repo}/issues/{index}/pin/{position}
```
`position` is a 1-based integer. Returns: HTTP 204

### List Pinned Issues
```
GET /repos/{owner}/{repo}/issues/pinned
```
Returns: `Issue[]`

### Check New Pin Allowed
```
GET /repos/{owner}/{repo}/new_pin_allowed
```
Returns: `NewIssuePinsAllowed { issues: bool, pull_requests: bool }`

---

## Issue Object Schema

```typescript
interface Issue {
  id?: number;           // global DB ID (not the display number)
  number?: number;       // repo-scoped issue number (use this in URLs)
  title?: string;
  body?: string;
  state?: StateType;     // "open" | "closed"
  user?: User;           // creator
  assignee?: User;
  assignees?: User[];
  labels?: Label[];
  milestone?: Milestone;
  comments?: number;     // comment count
  created_at?: string;   // ISO 8601
  updated_at?: string;
  closed_at?: string;
  due_date?: string;
  pull_request?: PullRequestMeta;  // non-null if this issue is a PR
  is_locked?: boolean;
  pin_order?: number;    // 0 if not pinned; position otherwise
  ref?: string;
  repository?: RepositoryMeta;
  original_author?: string;       // for migrated issues
  original_author_id?: number;
  html_url?: string;
  url?: string;
  assets?: Attachment[];
}
```

**Gitea-specific vs GitHub:**
- `number` is the repo-scoped index; `id` is the global DB ID. GitHub calls the display number `number` too, but Gitea has both.
- `pin_order` — no GitHub equivalent.
- `original_author` / `original_author_id` — for migrated content, no GitHub equivalent.
- `is_locked` is present but there's no dedicated lock/unlock endpoint in the public API.
- `due_date` — Gitea has native deadline support; GitHub does not.
- `StateType` is typed as `string` in TypeScript; values are `"open"` and `"closed"`.

---

## Issue Dependencies (Blocking)

Gitea models two directions: A **blocks** B (A must be resolved before B), and A **depends on** B.
From any issue's perspective: `/blocks` = issues that this issue blocks, `/dependencies` = issues that block this issue.

### List issues blocked BY this issue (this issue blocks them)
```
GET /repos/{owner}/{repo}/issues/{index}/blocks
```
Query: `page`, `limit`
Returns: `Issue[]` — the downstream issues that can't proceed until `{index}` is resolved.

### Add a blocking relationship (make this issue block another)
```
POST /repos/{owner}/{repo}/issues/{index}/blocks
```
Body: `IssueMeta { owner: string, repo: string, index: number }`

Returns: `Issue` (the issue that is now blocked)

**Note:** `{index}` in the URL path is typed as `string` in gitea-js (accepts number as string).
Body `IssueMeta.index` is `number`.

### Remove a blocking relationship
```
DELETE /repos/{owner}/{repo}/issues/{index}/blocks
```
Body: `IssueMeta { owner: string, repo: string, index: number }`
Returns: `Issue`

### List dependencies of this issue (issues that block this one)
```
GET /repos/{owner}/{repo}/issues/{index}/dependencies
```
Query: `page`, `limit`
Returns: `Issue[]` — issues that must be resolved before `{index}` can proceed.

### Add a dependency (make this issue depend on another)
```
POST /repos/{owner}/{repo}/issues/{index}/dependencies
```
Body: `IssueMeta { owner: string, repo: string, index: number }`
Returns: `Issue`

### Remove a dependency
```
DELETE /repos/{owner}/{repo}/issues/{index}/dependencies
```
Body: `IssueMeta { owner: string, repo: string, index: number }`
Returns: `Issue`

**Terminology clarification:**
- `GET /issues/{index}/blocks` → "issues blocked by {index}" = downstream dependents
- `GET /issues/{index}/dependencies` → "issues blocking {index}" = upstream blockers
- GitHub has no equivalent API; this is Gitea-only.

---

## Issue Comments

### List comments on an issue
```
GET /repos/{owner}/{repo}/issues/{index}/comments
```
| Param | Notes |
|---|---|
| `since` | date-time, RFC 3339 |
| `before` | date-time, RFC 3339 |

Returns: `Comment[]`
Note: no `page`/`limit` on this specific endpoint (lists all comments).

### List all comments in a repo
```
GET /repos/{owner}/{repo}/issues/comments
```
Query: `since`, `before`, `page`, `limit`
Returns: `Comment[]`

### Get single comment
```
GET /repos/{owner}/{repo}/issues/comments/{id}
```
Note: comment ID is the global DB ID, not a per-issue sequence.
Returns: `Comment`

### Create comment
```
POST /repos/{owner}/{repo}/issues/{index}/comments
```
Body: `{ body: string }` (required)
Returns: `Comment`

### Edit comment
```
PATCH /repos/{owner}/{repo}/issues/comments/{id}
```
Body: `{ body: string }` (required)
Returns: `Comment`

Deprecated variant: `PATCH /repos/{owner}/{repo}/issues/{index}/comments/{id}`

### Delete comment
```
DELETE /repos/{owner}/{repo}/issues/comments/{id}
```
Deprecated variant: `DELETE /repos/{owner}/{repo}/issues/{index}/comments/{id}`

### Comment schema
```typescript
interface Comment {
  id?: number;           // global DB ID
  body?: string;
  user?: User;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  issue_url?: string;
  pull_request_url?: string;
  original_author?: string;
  original_author_id?: number;
  assets?: Attachment[];
}
```

---

## Issue Timeline (comments + events)
```
GET /repos/{owner}/{repo}/issues/{index}/timeline
```
Query: `since`, `before`, `page`, `limit`
Returns: `TimelineComment[]` — includes all events (label changes, state changes, etc.) not just text comments.

---

## Labels

### Repo label CRUD
```
GET    /repos/{owner}/{repo}/labels         → Label[]    (page, limit)
POST   /repos/{owner}/{repo}/labels         → Label      (CreateLabelOption)
GET    /repos/{owner}/{repo}/labels/{id}    → Label
PATCH  /repos/{owner}/{repo}/labels/{id}    → Label      (EditLabelOption)
DELETE /repos/{owner}/{repo}/labels/{id}    → 204
```

### Label schema
```typescript
interface Label {
  id?: number;
  name?: string;
  color?: string;          // hex without #, e.g. "00aabb"
  description?: string;
  exclusive?: boolean;     // Gitea-only: exclusive label (scoped labels)
  is_archived?: boolean;   // Gitea-only: archived/hidden label
  url?: string;
}
```

**Gitea-specific:** `exclusive` labels are scoped — only one label with `exclusive=true` in a group can be applied at a time (like GitHub's scoped labels, but implemented differently). `is_archived` hides labels from UI while preserving existing uses.

### CreateLabelOption
```typescript
{ color: string, name: string, description?: string, exclusive?: boolean, is_archived?: boolean }
```
`color` must include the `#`, e.g. `"#00aabb"`.

### EditLabelOption
```typescript
{ color?: string, name?: string, description?: string, exclusive?: boolean, is_archived?: boolean }
```

### Labels on Issues/PRs

```
GET    /repos/{owner}/{repo}/issues/{index}/labels       → Label[]
POST   /repos/{owner}/{repo}/issues/{index}/labels       → Label[]   (add labels)
PUT    /repos/{owner}/{repo}/issues/{index}/labels       → Label[]   (replace all labels)
DELETE /repos/{owner}/{repo}/issues/{index}/labels       → 204       (remove ALL labels)
DELETE /repos/{owner}/{repo}/issues/{index}/labels/{id} → 204       (remove one label)
```

Body for POST and PUT: `IssueLabelsOption`
```typescript
interface IssueLabelsOption {
  labels?: (number | string)[];  // label IDs or label names (mixed array supported)
}
```

**Gitea-specific:** Labels can be specified by ID (int) or by name (string) in the same array.
GitHub only supports IDs.

---

## Milestones

```
GET    /repos/{owner}/{repo}/milestones           → Milestone[]
POST   /repos/{owner}/{repo}/milestones           → Milestone
GET    /repos/{owner}/{repo}/milestones/{id}      → Milestone
PATCH  /repos/{owner}/{repo}/milestones/{id}      → Milestone
DELETE /repos/{owner}/{repo}/milestones/{id}      → 204
```

List query params: `state` (`open|closed|all`), `name` (filter by name), `page`, `limit`.

### Milestone schema
```typescript
interface Milestone {
  id?: number;
  title?: string;
  description?: string;
  state?: StateType;       // "open" | "closed"
  open_issues?: number;
  closed_issues?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  due_on?: string;         // Note: GitHub calls this "due_on" too
}
```

### CreateMilestoneOption
```typescript
{ title?: string, description?: string, due_on?: date-time, state?: 'open'|'closed' }
```

### EditMilestoneOption
```typescript
{ title?: string, description?: string, due_on?: date-time, state?: string }
```

---

## Pull Requests

### List PRs
```
GET /repos/{owner}/{repo}/pulls
```
| Param | Type | Notes |
|---|---|---|
| `state` | `open\|closed\|all` | default `open` |
| `sort` | string | `oldest\|recentupdate\|leastupdate\|mostcomment\|leastcomment\|priority` |
| `milestone` | int64 | milestone ID |
| `labels` | number[] | label IDs |
| `poster` | string | filter by PR author username |
| `page` | int | 1-based |
| `limit` | int | |

Returns: `PullRequest[]`

### Get PR
```
GET /repos/{owner}/{repo}/pulls/{index}
```
Returns: `PullRequest`

### Get PR by base and head
```
GET /repos/{owner}/{repo}/pulls/{base}/{head}
```
Returns: `PullRequest`

### Create PR
```
POST /repos/{owner}/{repo}/pulls
```
Body: `CreatePullRequestOption`

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `body` | string | |
| `head` | string | source branch (or `fork:branch`) |
| `base` | string | target branch |
| `assignees` | string[] | |
| `assignee` | string | deprecated |
| `labels` | number[] | label IDs |
| `milestone` | int64 | |
| `reviewers` | string[] | usernames |
| `team_reviewers` | string[] | team slugs |
| `due_date` | date-time | |
| `allow_maintainer_edit` | bool | (not in gitea-js CreatePullRequestOption but supported in API) |

**Draft PR:** The gitea-js `CreatePullRequestOption` does not include a `draft` field.
The underlying Go struct (`CreatePullRequestOption`) also has no `draft` field as of v1.23.
**There is no API to create a draft PR or convert draft to ready.** This is a known Gitea limitation.

Returns: `PullRequest`

### Edit PR
```
PATCH /repos/{owner}/{repo}/pulls/{index}
```
Body: `EditPullRequestOption`

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `body` | string | |
| `state` | string | `"open"` or `"closed"` to close/reopen |
| `base` | string | change target branch |
| `assignees` | string[] | replaces all |
| `assignee` | string | deprecated |
| `labels` | number[] | replaces all |
| `milestone` | int64 | |
| `due_date` | date-time | |
| `unset_due_date` | bool | clear deadline |
| `allow_maintainer_edit` | bool | |

**No `draft` or `ready_for_review` field.** Draft status cannot be changed via API.

Returns: `PullRequest`

### Get PR diff / patch
```
GET /repos/{owner}/{repo}/pulls/{index}.{diffType}
```
`diffType`: `diff` or `patch`
Query: `binary` (bool) — include binary changes (makes patch applicable via `git apply`)
Returns: raw string

### Get PR commits
```
GET /repos/{owner}/{repo}/pulls/{index}/commits
```
Query: `page`, `limit`, `verification` (bool, default true), `files` (bool, default true)
Returns: `Commit[]`

### Get changed files
```
GET /repos/{owner}/{repo}/pulls/{index}/files
```
| Param | Notes |
|---|---|
| `skip-to` | filename to start from (cursor-style) |
| `whitespace` | `ignore-all\|ignore-change\|ignore-eol\|show-all` |
| `page`, `limit` | |

Returns: `ChangedFile[]`

### Check if merged
```
GET /repos/{owner}/{repo}/pulls/{index}/merge
```
Returns: HTTP 204 if merged, HTTP 404 if not.

### Merge PR
```
POST /repos/{owner}/{repo}/pulls/{index}/merge
```
Body: `MergePullRequestOption`

| Field | Type | Notes |
|---|---|---|
| `Do` | string | **required**: `merge\|rebase\|rebase-merge\|squash\|fast-forward-only\|manually-merged` |
| `MergeCommitID` | string | for `manually-merged` |
| `MergeMessageField` | string | commit message body |
| `MergeTitleField` | string | commit message title |
| `delete_branch_after_merge` | bool | |
| `force_merge` | bool | override merge checks |
| `head_commit_id` | string | guard against race condition |
| `merge_when_checks_succeed` | bool | schedule auto-merge |

**Gitea-specific:** `manually-merged` value marks an already-merged PR without actually merging.
`fast-forward-only` is supported (not in GitHub API).

### Cancel auto-merge
```
DELETE /repos/{owner}/{repo}/pulls/{index}/merge
```

### Update PR branch (merge base into head)
```
POST /repos/{owner}/{repo}/pulls/{index}/update
```
Query: `style` — `merge` or `rebase`

### PullRequest schema
```typescript
interface PullRequest {
  id?: number;               // global DB ID
  number?: number;           // repo-scoped PR number
  title?: string;
  body?: string;
  state?: StateType;         // "open" | "closed"
  draft?: boolean;           // Gitea-specific: draft PR flag (read-only via API)
  user?: User;
  assignee?: User;
  assignees?: User[];
  labels?: Label[];
  milestone?: Milestone;
  base?: PRBranchInfo;       // target branch info
  head?: PRBranchInfo;       // source branch info
  merge_base?: string;       // SHA of common ancestor
  merge_commit_sha?: string; // SHA of merge commit (null if not merged)
  merged?: boolean;
  merged_at?: string;
  merged_by?: User;
  mergeable?: boolean;
  allow_maintainer_edit?: boolean;
  requested_reviewers?: User[];
  requested_reviewers_teams?: Team[];
  comments?: number;
  review_comments?: number;  // diff-level review comments only
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  due_date?: string;
  diff_url?: string;
  patch_url?: string;
  html_url?: string;
  url?: string;
  is_locked?: boolean;
  pin_order?: number;
}

interface PRBranchInfo {
  label?: string;   // "owner:branch"
  ref?: string;     // branch name
  sha?: string;     // HEAD SHA
  repo_id?: number;
  repo?: Repository;
}
```

**Gitea-specific vs GitHub:**
- `draft` is present but **read-only** — cannot be set/changed via API.
- `pin_order` — no GitHub equivalent.
- `allow_maintainer_edit` — GitHub calls this `maintainer_can_modify`.
- GitHub has `review_decision` (computed field); Gitea does not — you must compute approval state from the reviews list.
- GitHub uses `head.repo` and `base.repo` as nested objects; Gitea uses the same pattern via `PRBranchInfo.repo`.
- `due_date` — Gitea-only deadline field.

---

## PR Reviews

### List reviews
```
GET /repos/{owner}/{repo}/pulls/{index}/reviews
```
Query: `page`, `limit`
Returns: `PullReview[]`

### Create review (or start a pending review)
```
POST /repos/{owner}/{repo}/pulls/{index}/reviews
```
Body: `CreatePullReviewOptions`

| Field | Type | Notes |
|---|---|---|
| `event` | ReviewStateType | `APPROVED\|REQUEST_CHANGES\|COMMENT\|PENDING` |
| `body` | string | overall review comment |
| `commit_id` | string | commit to review at (defaults to head) |
| `comments` | CreatePullReviewComment[] | inline diff comments |

`CreatePullReviewComment`:
```typescript
{
  path?: string;         // file path
  body?: string;         // comment text
  new_position?: number; // line in new file (0 = not a line comment)
  old_position?: number; // line in old file (0 = not a line comment)
}
```

To create a **pending** review (accumulate comments before submitting), pass `event: "PENDING"` or omit `event`.
Returns: `PullReview`

### Get a review
```
GET /repos/{owner}/{repo}/pulls/{index}/reviews/{id}
```
Returns: `PullReview`

### Submit (publish) a pending review
```
POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}
```
Body: `SubmitPullReviewOptions`
```typescript
{ body?: string, event?: ReviewStateType }
```
`event` values: `APPROVED`, `REQUEST_CHANGES`, `COMMENT`
Returns: `PullReview`

### Delete a review
```
DELETE /repos/{owner}/{repo}/pulls/{index}/reviews/{id}
```
Returns: HTTP 204

### Get review inline comments
```
GET /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments
```
Returns: `PullReviewComment[]`

### Dismiss a review
```
POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/dismissals
```
Body: `DismissPullReviewOptions`
```typescript
{ message?: string, priors?: boolean }
```
`priors: true` dismisses all prior reviews from the same reviewer.
Returns: `PullReview`

### Un-dismiss a review
```
POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/undismissals
```
Returns: `PullReview`

### Request / cancel review requests
```
POST   /repos/{owner}/{repo}/pulls/{index}/requested_reviewers   → PullReview[]
DELETE /repos/{owner}/{repo}/pulls/{index}/requested_reviewers   → 204
```
Body: `PullReviewRequestOptions { reviewers?: string[], team_reviewers?: string[] }`

### PullReview schema
```typescript
interface PullReview {
  id?: number;
  user?: User;
  team?: Team;                 // for team review requests
  body?: string;              // overall comment text
  state?: ReviewStateType;    // "APPROVED" | "REQUEST_CHANGES" | "COMMENT" | "PENDING"
  commit_id?: string;         // commit SHA the review is on
  submitted_at?: string;
  updated_at?: string;
  stale?: boolean;            // GITEA-SPECIFIC: true if head has moved since review
  official?: boolean;         // GITEA-SPECIFIC: counts toward required approvals
  dismissed?: boolean;
  comments_count?: number;
  html_url?: string;
  pull_request_url?: string;
}
```

**Gitea-specific vs GitHub:**
- `official` — whether this review counts toward branch protection required approvals. No GitHub equivalent.
- `stale` — whether the PR head has been updated since this review was submitted, making it outdated. GitHub shows this in UI but doesn't expose it as a field.
- **No `reviewDecision` equivalent** — Gitea has no computed "overall review decision" field on the PR object. You must fetch all reviews and compute:
  - Count `APPROVED` reviews where `official=true` and `stale=false` and `dismissed=false`.
  - Check if any `REQUEST_CHANGES` review is `official=true` and not dismissed.
- `ReviewStateType` string values: `"APPROVED"`, `"REQUEST_CHANGES"`, `"COMMENT"`, `"PENDING"`

### PullReviewComment schema
```typescript
interface PullReviewComment {
  id?: number;
  body?: string;
  path?: string;
  position?: number;           // line in new file
  original_position?: number;  // line in old file
  diff_hunk?: string;          // context diff around the comment
  commit_id?: string;
  original_commit_id?: string;
  pull_request_review_id?: number;
  pull_request_url?: string;
  user?: User;
  resolver?: User;             // GITEA-SPECIFIC: user who resolved the thread
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}
```

---

## Commit Statuses (CI checks)

Gitea uses commit statuses (like GitHub's commit status API), **not** GitHub Check Runs.
There is no Gitea equivalent to `GET /check-runs` or `GET /check-suites`.

### List statuses by ref (branch/tag/commit)
```
GET /repos/{owner}/{repo}/commits/{ref}/statuses
```
| Param | Notes |
|---|---|
| `sort` | `oldest\|recentupdate\|leastupdate\|leastindex\|highestindex` |
| `state` | `pending\|success\|error\|failure\|warning` |
| `page`, `limit` | |

Returns: `CommitStatus[]`

### Get combined status by ref
```
GET /repos/{owner}/{repo}/commits/{ref}/status
```
Returns: `CombinedStatus`

```typescript
interface CombinedStatus {
  sha?: string;
  state?: CommitStatusState;  // overall: worst of all statuses
  statuses?: CommitStatus[];
  total_count?: number;
  repository?: Repository;
  commit_url?: string;
  url?: string;
}
```

### List statuses by SHA
```
GET /repos/{owner}/{repo}/statuses/{sha}
```
Same query params as above. Returns: `CommitStatus[]`

### Create a commit status
```
POST /repos/{owner}/{repo}/statuses/{sha}
```
Body: `CreateStatusOption`
```typescript
{
  context?: string;      // e.g. "ci/test" — identifies the check
  state?: CommitStatusState;  // "pending" | "success" | "error" | "failure"
  description?: string;
  target_url?: string;   // link to build/CI page
}
```
Returns: `CommitStatus`

### CommitStatus schema
```typescript
interface CommitStatus {
  id?: number;
  context?: string;       // identifier, e.g. "ci/build"
  status?: CommitStatusState;  // "pending" | "success" | "error" | "failure"
  description?: string;
  target_url?: string;
  creator?: User;
  created_at?: string;
  updated_at?: string;
  url?: string;
}
```

**CommitStatusState values:** `"pending"`, `"success"`, `"error"`, `"failure"`, `"warning"`, `"skipped"`
Note: `"warning"` is valid in list/filter but the spec comment says "pending, success, error and failure" for CreateStatusOption — `warning` may not be creatable.
Note: `"skipped"` exists in current Gitea server code but is absent from older OpenAPI specs; older instances never emit it.
Gitea's own combine logic treats `warning` as a failing state and `skipped` as compatible with success.

**For PR CI status:** Use `GET /repos/{owner}/{repo}/commits/{ref}/status` where `ref` is the PR head SHA (`pr.head.sha`).

---

## Projects

Gitea has a projects feature (kanban boards) but **no REST API endpoints for projects** are exposed as of v1.23.
- `project_id` appears in `TimelineComment` (for "moved to project" events) but there's no CRUD API.
- Repository settings expose `has_projects` (bool) and `projects_mode` (`"repo"|"owner"|"all"`).
- Project management must be done through the web UI.

**GitHub comparison:** GitHub has a full Projects v2 GraphQL API and Projects REST API. Gitea has neither.

---

## Draft Pull Requests

Gitea supports draft PRs in the web UI but has **significant API limitations:**

1. **Cannot create a draft PR via API** — `CreatePullRequestOption` has no `draft` field.
2. **Cannot convert draft to ready via API** — `EditPullRequestOption` has no `draft` or `ready_for_review` field.
3. **Can read draft status** — `PullRequest.draft` is a readable boolean field.
4. **Workaround:** Title prefix convention — some users prefix draft PR titles with `[WIP]` or `Draft:` and remove the prefix to signal readiness, but this is not enforced by the API.

The `op_type` enum in activity includes `pull_request_ready_for_review`, indicating the feature exists in the event log, but no API to trigger this transition is exposed.

---

## PR Comments (Review Comments vs Issue Comments)

Gitea separates:

1. **Issue-style PR comments** (general comments, not tied to diff lines):
   - `GET/POST /repos/{owner}/{repo}/issues/{index}/comments`
   - Same `Comment` schema as issue comments.

2. **Review comments** (diff-level, tied to a review):
   - `GET /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments`
   - Created as part of `CreatePullReviewOptions.comments[]`.
   - Schema: `PullReviewComment`.

There is no endpoint to create a standalone review comment outside of a review (unlike GitHub's `POST /pulls/{index}/comments`).

---

## Complete Endpoint Index (Relevant to gitea-axi)

### Issues
| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/issues` | list; `type=issues` for issues only |
| POST | `/repos/{owner}/{repo}/issues` | create |
| GET | `/repos/{owner}/{repo}/issues/{index}` | get |
| PATCH | `/repos/{owner}/{repo}/issues/{index}` | edit; use `state` to close/reopen |
| DELETE | `/repos/{owner}/{repo}/issues/{index}` | delete (admin) |
| POST | `/repos/{owner}/{repo}/issues/{index}/pin` | pin |
| DELETE | `/repos/{owner}/{repo}/issues/{index}/pin` | unpin |
| PATCH | `/repos/{owner}/{repo}/issues/{index}/pin/{position}` | move pin |
| GET | `/repos/{owner}/{repo}/issues/{index}/blocks` | list blocked issues |
| POST | `/repos/{owner}/{repo}/issues/{index}/blocks` | add blocking |
| DELETE | `/repos/{owner}/{repo}/issues/{index}/blocks` | remove blocking |
| GET | `/repos/{owner}/{repo}/issues/{index}/dependencies` | list blockers |
| POST | `/repos/{owner}/{repo}/issues/{index}/dependencies` | add dependency |
| DELETE | `/repos/{owner}/{repo}/issues/{index}/dependencies` | remove dependency |
| GET | `/repos/{owner}/{repo}/issues/{index}/comments` | list comments |
| POST | `/repos/{owner}/{repo}/issues/{index}/comments` | add comment |
| GET | `/repos/{owner}/{repo}/issues/comments/{id}` | get comment |
| PATCH | `/repos/{owner}/{repo}/issues/comments/{id}` | edit comment |
| DELETE | `/repos/{owner}/{repo}/issues/comments/{id}` | delete comment |
| GET | `/repos/{owner}/{repo}/issues/{index}/timeline` | comments + events |
| GET | `/repos/{owner}/{repo}/issues/{index}/labels` | get labels |
| POST | `/repos/{owner}/{repo}/issues/{index}/labels` | add labels |
| PUT | `/repos/{owner}/{repo}/issues/{index}/labels` | replace labels |
| DELETE | `/repos/{owner}/{repo}/issues/{index}/labels` | clear all labels |
| DELETE | `/repos/{owner}/{repo}/issues/{index}/labels/{id}` | remove one label |
| GET | `/repos/issues/search` | cross-repo search |
| GET | `/repos/{owner}/{repo}/issues/pinned` | list pinned |

### Pull Requests
| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/pulls` | list |
| POST | `/repos/{owner}/{repo}/pulls` | create |
| GET | `/repos/{owner}/{repo}/pulls/{index}` | get |
| PATCH | `/repos/{owner}/{repo}/pulls/{index}` | edit |
| GET | `/repos/{owner}/{repo}/pulls/{index}.diff` | get diff |
| GET | `/repos/{owner}/{repo}/pulls/{index}.patch` | get patch |
| GET | `/repos/{owner}/{repo}/pulls/{index}/commits` | get commits |
| GET | `/repos/{owner}/{repo}/pulls/{index}/files` | get changed files |
| GET | `/repos/{owner}/{repo}/pulls/{index}/merge` | check if merged |
| POST | `/repos/{owner}/{repo}/pulls/{index}/merge` | merge |
| DELETE | `/repos/{owner}/{repo}/pulls/{index}/merge` | cancel auto-merge |
| POST | `/repos/{owner}/{repo}/pulls/{index}/update` | sync base into head |
| GET | `/repos/{owner}/{repo}/pulls/{base}/{head}` | get by branches |
| GET | `/repos/{owner}/{repo}/pulls/{index}/reviews` | list reviews |
| POST | `/repos/{owner}/{repo}/pulls/{index}/reviews` | create review |
| GET | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}` | get review |
| POST | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}` | submit pending review |
| DELETE | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}` | delete review |
| GET | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments` | get review comments |
| POST | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}/dismissals` | dismiss review |
| POST | `/repos/{owner}/{repo}/pulls/{index}/reviews/{id}/undismissals` | undismiss review |
| POST | `/repos/{owner}/{repo}/pulls/{index}/requested_reviewers` | request reviewers |
| DELETE | `/repos/{owner}/{repo}/pulls/{index}/requested_reviewers` | cancel review request |
| GET | `/repos/{owner}/{repo}/pulls/pinned` | list pinned PRs |

### Labels
| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/labels` | list |
| POST | `/repos/{owner}/{repo}/labels` | create |
| GET | `/repos/{owner}/{repo}/labels/{id}` | get |
| PATCH | `/repos/{owner}/{repo}/labels/{id}` | update |
| DELETE | `/repos/{owner}/{repo}/labels/{id}` | delete |

### Milestones
| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/milestones` | list (`state`, `name`, `page`, `limit`) |
| POST | `/repos/{owner}/{repo}/milestones` | create |
| GET | `/repos/{owner}/{repo}/milestones/{id}` | get |
| PATCH | `/repos/{owner}/{repo}/milestones/{id}` | update |
| DELETE | `/repos/{owner}/{repo}/milestones/{id}` | delete |

### Commit Statuses
| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/commits/{ref}/status` | combined status |
| GET | `/repos/{owner}/{repo}/commits/{ref}/statuses` | list by ref |
| GET | `/repos/{owner}/{repo}/statuses/{sha}` | list by SHA |
| POST | `/repos/{owner}/{repo}/statuses/{sha}` | create status |
