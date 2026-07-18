# Gitea: Web UI vs REST API Parity Gaps

Capabilities that Gitea's web UI exposes but its REST API does not, in the issue / pull request / review / comment / label / milestone domain.

Every finding is framed as an **API-consumer parity** claim — "the web UI can do X, the API cannot" — because that is the argument that stands on Gitea's own terms, independent of any particular client.

## Provenance

Analysed against `go-gitea/gitea` at commit `e8befe026853a90a9efca559ca9f9cac8b41fc88` (2026-07-18).
Claims below cite that tree; re-verify before filing if upstream has moved.

Method: every web route registered under the issue/PR paths in `routers/web/web.go` was paired against `routers/api/v1/api.go`, then each unpaired route was traced to the `services/` or `models/` function its handler calls, and that function checked for reachability from any API handler.
Each surviving finding was cross-checked against `templates/swagger/v1_json.tmpl`, Gitea's generated OpenAPI spec.

Excluded by design: presentation-only routes (HTMX partial re-renders, template fragments, sort/filter preferences, diff view-style toggles) — they carry no server-side capability.
Also out of scope for this pass: projects/kanban boards and issue/PR templates, which are separate domains deserving their own sweep.

### Already closed upstream

Two gaps that motivated this review turned out to be **already fixed on main** and are not contribution targets:

- Resolving and unresolving review conversations — `POST /repos/{owner}/{repo}/pulls/comments/{id}/resolve` and `/unresolve` exist (`routers/api/v1/api.go`).
- Replying to an inline review comment — `POST /repos/{owner}/{repo}/pulls/{index}/comments/{id}/replies` exists.

Inline review comments can also be created through `POST /pulls/{index}/reviews` with a `comments[]` array.
What remains missing on that front is narrower and is recorded as finding 2.

## Findings, ranked

Ranked by blast radius across API consumers, tiebroken by how mechanical the fix looks.

| # | Gap | Class | Tractability | Prior art |
|---|-----|-------|--------------|-----------|
| 1 | Merge blockers not exposed | response-shape | medium | open issue #13879 (2020, no attempt) |
| 2 | Cannot accumulate a pending review | missing route | medium | closed #15933; wishlist #32898 |
| 3 | Review comments never report `invalidated` | response-shape | trivial | none |
| 4 | Time estimates readable but not writable | underpowered | trivial | none; read half merged as #35475 |
| 5 | No batch issue operations | missing route | large | none |
| 6 | Content edit history entirely absent | missing route | medium | open issue #6454 (2019, 13 reactions) |
| 7 | Review comments cannot carry attachments | underpowered | small | none; web half merged as #29220 |
| 8 | Per-user "viewed files" state is web-only | missing route | small | open issue #32898 |
| 9 | Label-set initialization is web-only | missing route | trivial | partial: #24602, #6061 |

No stalled or closed-unmerged PR exists for any of the nine, with one exception ([#36903](https://github.com/go-gitea/gitea/pull/36903), closed on API shape rather than on principle).
There is no abandoned branch to revive, and no record of a maintainer having rejected any of these on design grounds.

### Recommended filing order

The ranking above measures the size of each gap.
Filing order should follow the strength of the maintainer signal instead, which points somewhere different:

1. **Finding 4** — merged PR #35475 exposed `time_estimate` for reading and stopped; a write route completes work maintainers already accepted, reusing an existing service function. Lowest-risk first contribution.
2. **Finding 7** — same shape: merged PR #29220 built the capability and missed the API struct. An oversight fix, not a proposal.
3. **Finding 3** — no prior art at all, trivial patch, with #15167 as a precedent for adding fields to this exact struct.
4. **Finding 1** — the largest gap, but a six-year-old issue with no maintainer signal. File as a comment on #13879 with the structured-blocker proposal.
5. **Findings 2, 6, 8** — each has a live issue (#32898, #6454) to comment on rather than duplicate.
6. **Finding 5** — open as a discussion first; the request shape is a real design decision.
7. **Finding 9** — file only if the others land; it is the weakest of the nine.

---

### 1. Merge blockers are not exposed; the API returns a bare `mergeable` boolean

**Class**: response-shape omission.

**Web**: `GET /{owner}/{repo}/pulls/{index}/merge_box` → `ViewPullMergeBox` (`routers/web/repo/issue_view.go:428`), populating `pullMergeBoxData` (`routers/web/repo/pull.go:290`).

**Capability reached**: that struct carries `isBlockedByApprovals`, `isBlockedByRejection`, `isBlockedByOfficialReviewRequests`, `isBlockedByOutdatedBranch`, `isBlockedByChangedProtectedFiles` (`routers/web/repo/pull.go:303-309`), plus status-check state and required-signing state, all derived from the protected branch rule and `services/pull`.

**Current API**: `PullRequest.Mergeable bool` (`modules/structs/pull.go`) — one boolean, no reason.

**Swagger evidence**: `merge_box` appears zero times in `templates/swagger/v1_json.tmpl`; the `PullRequest` definition carries no blocker fields.

**Parity impact**: any consumer automating merges — CI bots, merge queues, dashboards, third-party clients — can see *that* a PR is unmergeable but never *why*.
The choice is to re-implement Gitea's branch-protection logic client-side against several other endpoints, or to surface a merge button that fails with no explanation.
This is the single largest structural asymmetry in the PR domain.

**Patch sketch**: the blocker computation currently lives in the web layer and would need extracting into `services/pull` as a function returning a structured result, leaving `ViewPullMergeBox` a thin caller.
Then either add the fields to `PullRequest` under `omitempty` (cheap, but computed on every PR read — likely too expensive for list endpoints) or add a dedicated `GET /repos/{owner}/{repo}/pulls/{index}/merge_status` returning the structured blockers.
The dedicated endpoint is the defensible proposal; the struct change invites a performance objection on `ListPullRequests`.

**Prior art**: open issue [#13879](https://github.com/go-gitea/gitea/issues/13879), "[api] pull request field Mergeable = ture but not aproved" — open since 2020, labeled `topic/api`, asking for exactly this ("an extra field witch show if a pull is realy ready to merge (required ci passed & required reviews)").
Six years open with no implementation attempt and no maintainer resolution.
Supporting: open issue [#25849](https://github.com/go-gitea/gitea/issues/25849) reports the `mergeable` boolean holding a stale `false` after a conflict is resolved — a correctness bug rather than this request, but useful evidence that the single boolean is inadequate.
No PR has ever proposed surfacing the blocker reasons.
Adjacent but distinct: open PR [#38404](https://github.com/go-gitea/gitea/pull/38404) exposes scheduled auto-merge via the API, not merge blockers.

---

### 2. A pending review cannot be accumulated across calls

**Class**: missing route.

**Web**: `POST /{owner}/{repo}/pulls/{index}/files/reviews/comments` → `CreateCodeComment` (`routers/web/repo/pull_review.go`), bound to `forms.CodeCommentForm` whose `SingleReview` flag decides whether the comment lands in the doer's open pending review or stands alone.

**Capability reached**: `pull_service.CreateCodeComment(..., pendingReview bool, replyReviewID int64, ...)` (`services/pull/review.go:116`).

**Current API**: `POST /pulls/{index}/reviews` → `CreatePullReview` (`routers/api/v1/repo/pull_review.go:466`) creates the comments with `pendingReview=true` and then immediately calls `pull_service.SubmitReview` in the same request.
There is no `POST /pulls/{index}/reviews/{id}/comments`, so a review cannot be opened, added to over several calls, and submitted later — the entire review must be assembled in one request body.

**Swagger evidence**: no route under `reviews/{id}` accepts comments; `GET .../reviews/{id}/comments` is read-only.

**Parity impact**: a reviewer client that walks a diff file by file — which is how both humans and automated reviewers work — cannot mirror the web UI's incremental flow.
It must buffer every comment in its own memory and hope the single submitting request succeeds, with no server-side draft to recover if it does not.

**Patch sketch**: add `POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments` accepting the existing `CreatePullReviewComment` shape, validating that review `{id}` belongs to the doer and is in pending state, then calling `pull_service.CreateCodeComment` with `pendingReview=true` and the review id.
The service function already takes every argument required; this is routing and validation only.
A companion `POST /pulls/{index}/reviews` with `event: PENDING` returning the open review already exists as the entry point.

**Prior art**: closed issue [#15933](https://github.com/go-gitea/gitea/issues/15933), "[API] Cannot create a pending review without body (but with a file comment)" — the reporter's stated goal was to "initiate pending reviews with file-specific comments, then publish the review later via submission", i.e. this exact workflow.
It was labeled `issue/confirmed` and closed without that workflow being delivered.

This finding needs the most careful framing of the nine, because two recent changes look like they already solved it and do not:

- Merged PR [#36683](https://github.com/go-gitea/gitea/pull/36683) added `POST .../pulls/{index}/comments/{id}/replies`, which replies to an *already-posted* comment; its own notes state that "reply-only requests skip creating pending reviews".
- PR [#36903](https://github.com/go-gitea/gitea/pull/36903) proposed an `in_reply_to` field and was closed unmerged as a duplicate, on API *shape* grounds (silverwind preferred keying off `comment_id` to match GitHub) rather than on the capability being unwanted — a favourable signal for a fresh proposal.

Lead any filing with the `single_review=false` web-route contrast so a skimming reviewer does not mistake it for #36683.

Also relevant: open issue [#32898](https://github.com/go-gitea/gitea/issues/32898) ("expansions to the pull review API") collects a wishlist of review-API additions and is the natural place to raise this alongside finding 8.

---

### 3. Review comments never report whether they are outdated

**Class**: response-shape omission.

**Web**: the diff view branches on outdated state throughout (`SetShowOutdatedComments` middleware on the `pulls/{index}/files` routes in `routers/web/web.go:1645-1651`).

**Capability reached**: `issues_model.Comment.Invalidated bool` (`models/issues/comment.go:317`), set when the commented line no longer exists in the current diff.

**Current API**: `PullReviewComment` (`modules/structs/pull_review.go`) exposes `Resolver` but not `Invalidated`, and carries no review-thread grouping identifier.

**Swagger evidence**: `invalidated` appears zero times in `templates/swagger/v1_json.tmpl`.

**Parity impact**: a consumer listing review comments cannot distinguish live feedback from comments stranded by subsequent pushes, so it either surfaces stale review threads as actionable or silently drops them.
The web UI hides them behind a toggle precisely because the distinction matters.

**Patch sketch**: add `Invalidated bool \`json:"invalidated"\`` to `PullReviewComment` and populate it in `ToPullReviewComment` (`services/convert/pull_review.go:103`), alongside the existing `Resolver` assignment on line 108.
Roughly a three-line change plus the swagger regeneration.
An explicit `resolved bool` could ride along in the same patch, since `Resolver != nil` is currently the only way to infer it.

**Prior art**: none — the cleanest filing of the nine.
No issue or PR has ever asked for `invalidated` on the API struct, and none has asked for a review-thread grouping identifier.
Existing work on `Invalidated` is confined to the model and UI layers ([#8751](https://github.com/go-gitea/gitea/pull/8751), [#12548](https://github.com/go-gitea/gitea/pull/12548)–[#12550](https://github.com/go-gitea/gitea/pull/12550)).

There is a precedent chain worth citing: merged PR [#15167](https://github.com/go-gitea/gitea/pull/15167) added the `resolver` object to this exact struct — and its author noted in passing that "only the first comment of a conversation might have a resolver, the others seem to be always nil", which is the missing thread-grouping identifier being observed and left alone.
Merged PR [#36441](https://github.com/go-gitea/gitea/pull/36441) then added the resolve/unresolve routes without adding a `resolved` field; verified against `modules/structs/pull_review.go` at this commit, the struct still carries only `Resolver`.
Fields do get added to `PullReviewComment` when someone asks.

---

### 4. Time estimates are readable but not writable

**Class**: underpowered — the field exists in responses with no write path.

**Web**: `POST /{owner}/{repo}/{type:issues|pulls}/{index}/time_estimate` → `UpdateIssueTimeEstimate` (`routers/web/repo/issue_timetrack.go`).

**Capability reached**: `issue_service.ChangeTimeEstimate` (`services/issue/issue.go:130`).

**Current API**: none.
`EditIssueOption` (`modules/structs/issue.go`) has no time-estimate field, and no dedicated route exists.

**Swagger evidence**: `time_estimate` appears exactly once in `templates/swagger/v1_json.tmpl` — as an `int64` property on the `Issue` schema, i.e. read-only by construction.

**Parity impact**: a field the API hands back cannot be set through the API.
Any planning or import tool must either leave estimates empty or drive the web form, and round-tripping an issue through the API silently drops the estimate.
The read/write asymmetry makes this an easy argument: the API already acknowledges the concept.

**Patch sketch**: the service function exists and is already permission-checked at the caller.
Either add `TimeEstimate *int64` to `EditIssueOption` and call `issue_service.ChangeTimeEstimate` from `EditIssue`, or mirror the web layout with `POST /repos/{owner}/{repo}/issues/{index}/time_estimate`.
The `EditIssueOption` route is preferable — it matches how `deadline` and `ref` are already handled and adds no new path.

**Prior art**: no issue or PR has ever asked for the write side.
The read side is merged PR [#35475](https://github.com/go-gitea/gitea/pull/35475), "Exposing TimeEstimate field in the API" (September 2025), which added `time_estimate` to the issue API response and to webhooks — and stopped there.
That is the strongest maintainer signal in this document: they have already accepted exposing this field through the API and simply implemented half of it.
A write route completing work they merged is an easy review.
Merged PR [#38423](https://github.com/go-gitea/gitea/pull/38423) (July 2026) recently hardened the `util` duration parser a write endpoint would reuse.
Tangential only: open issue [#33318](https://github.com/go-gitea/gitea/issues/33318) is about the web UI's estimate widget, and [#23112](https://github.com/go-gitea/gitea/issues/23112) is the closed original feature request.

---

### 5. No batch issue operations

**Class**: missing route.

**Web**: the issue list acts on many issues per request — `POST /{owner}/{repo}/{type}/status` (`UpdateIssueStatus`, `routers/web/repo/issue_list.go:402`), `POST /{owner}/{repo}/{type}/labels` (`UpdateIssueLabel`, `routers/web/repo/issue_label.go:167`), `POST /{owner}/{repo}/{type}/delete` (`BatchDeleteIssues`, `routers/web/repo/issue_list.go:387`), plus batch milestone and assignee updates registered alongside them (`routers/web/web.go:1373-1379`).

**Current API**: every one of these is per-issue only — `PATCH /issues/{index}`, `POST|DELETE /issues/{index}/labels`, `DELETE /issues/{index}`.

**Swagger evidence**: no bulk route exists in the spec under `/repos/{owner}/{repo}/issues`.

**Parity impact**: triaging fifty issues costs fifty round trips and fifty webhook deliveries, against one in the browser.
On instances with rate limiting in front of them, bulk triage via API is effectively impractical — the exact workload automation exists to serve.

**Patch sketch**: this is the least mechanical of the nine.
The web handlers take a form-encoded issue-id list and are entangled with redirect/flash behaviour, so extraction into `services/issue` comes first.
A clean proposal would add `POST /repos/{owner}/{repo}/issues/batch` taking `{ "issues": [1,2,3], "state": "closed", "add_labels": [...], "remove_labels": [...], "milestone": N, "assignees": [...] }` with per-item results so partial failures are reportable.
Worth opening as a discussion issue before writing code — the request shape is a genuine design decision and a maintainer will have opinions.

**Prior art**: none.
Every bulk-issue item upstream is web-UI-scoped — the requests that *built* the UI's bulk actions, not requests to expose them: [#18883](https://github.com/go-gitea/gitea/issues/18883) (bulk select), [#22273](https://github.com/go-gitea/gitea/issues/22273) (delete multiple, which drove `BatchDeleteIssues`), [#17216](https://github.com/go-gitea/gitea/issues/17216) (mass-assign to project), plus open UI bugs [#24185](https://github.com/go-gitea/gitea/issues/24185) and [#24651](https://github.com/go-gitea/gitea/issues/24651).

Useful precedent that the pattern is acceptable in principle: batch APIs have been requested for other resources — open issue [#33611](https://github.com/go-gitea/gitea/issues/33611) (batch repository imports) and closed [#22138](https://github.com/go-gitea/gitea/issues/22138) (batch change file API).
Nobody has ever raised it for issues.

---

### 6. Issue and comment content edit history is entirely absent

**Class**: missing route.

**Web**: four handlers in `routers/web/repo/issue_content_history.go` — `GetContentHistoryOverview`, `GetContentHistoryList`, `GetContentHistoryDetail`, `SoftDeleteContentHistory` — registered at `routers/web/web.go:1301-1305` and `:1367`.

**Capability reached**: `models/issues/content_history`, which records every edit of an issue or comment body.

**Current API**: none.

**Swagger evidence**: `content_history` and `content-history` each appear zero times in `templates/swagger/v1_json.tmpl`.

**Parity impact**: the API presents issue and comment bodies as if they had no history, while the database and the web UI both know otherwise.
Audit tooling, compliance exports, and migration tools cannot see that a body was edited, let alone what it said before — and `content_version` is already exposed on `EditIssueOption` for conflict detection, so the API half-acknowledges versioning while offering no way to read it.
Sharper still: since the fix for [#30807](https://github.com/go-gitea/gitea/issues/30807), API-driven edits *do* write content-history rows.
The API therefore produces history it cannot read back.

**Patch sketch**: add read routes mirroring the web handlers under `GET /repos/{owner}/{repo}/issues/{index}/content-history` (list) and `.../content-history/{id}` (detail), with the comment variants under the existing comment paths.
The model layer needs no change; the work is converters for the history records plus the same permission checks `canSoftDeleteContentHistory` already encodes.
Propose read-only first — soft-delete is a separate and more contentious surface.

**Prior art**: open issue [#6454](https://github.com/go-gitea/gitea/issues/6454), "Expose issue edition through the API" — open since March 2019, 13 positive reactions, still seeing activity in April 2026, filed by the git-bug author who wants edit history for an offline-capable bridge and cites GitHub's GraphQL `userContentEdits` as the model.
Seven years open, no PR ever attempted.
Comment on it rather than filing a duplicate.

Reinforcing: closed issue [#30807](https://github.com/go-gitea/gitea/issues/30807) reported that API-driven edits were not recording history rows at all, fixed by merged PRs [#30814](https://github.com/go-gitea/gitea/pull/30814) and [#30845](https://github.com/go-gitea/gitea/pull/30845).
So the API now *writes* content history it still cannot read back — a sharper framing of the gap than the one above.

---

### 7. Review comments cannot carry attachments

**Class**: underpowered.

**Web**: `forms.CodeCommentForm.Files` (`services/forms/repo_form.go`) is passed straight through by `CreateCodeComment` (`routers/web/repo/pull_review.go`).

**Capability reached**: `pull_service.CreateCodeComment(..., attachments []string)` (`services/pull/review.go:116`).

**Current API**: `CreatePullReviewComment` (`modules/structs/pull_review.go`) has only `Path`, `Body`, `OldLineNum`, `NewLineNum`.
The API always passes a nil attachment list.

**Swagger evidence**: no attachment field on the review-comment request definitions.

**Parity impact**: inconsistent with the rest of the API, which supports attachments on issues and issue comments through the `/assets` routes.
A reviewer client cannot attach a screenshot or log to inline feedback, though the service layer accepts one.

**Patch sketch**: add `Attachments []string` to `CreatePullReviewComment` (and to the reply options), pass it through in `CreatePullReview` at `routers/api/v1/repo/pull_review.go:466` and in `CreatePullReviewCommentReply` at `:209`.
Uploads already have a route; this only carries the resulting UUIDs.

**Prior art**: none for the API side.
Merged PR [#29220](https://github.com/go-gitea/gitea/pull/29220), "Add attachment support for code review comments" (February 2024), is the change that added the `attachments []string` parameter to `pull_service.CreateCodeComment` and wired the web form to it, resolving web-side requests [#27960](https://github.com/go-gitea/gitea/issues/27960), [#24411](https://github.com/go-gitea/gitea/issues/24411) and [#12183](https://github.com/go-gitea/gitea/issues/12183).
It did not touch `CreatePullReviewComment` — the asymmetry is a straightforward oversight in an otherwise complete feature, which is the easiest kind of gap to get accepted.
Note that [#32898](https://github.com/go-gitea/gitea/issues/32898)'s review-API wishlist does *not* mention attachments, so this one stands alone.

---

### 8. Per-user "viewed files" state is web-only

**Class**: missing route.

**Web**: `POST /{owner}/{repo}/{type:pulls}/{index}/viewed-files` → `UpdateViewedFiles` (`routers/web/repo/pull_review.go:303`), registered at `routers/web/web.go:1347`.

**Capability reached**: the per-user, per-file reviewed-state records backing the diff view's viewed checkboxes.

**Current API**: none, for reading or writing.

**Swagger evidence**: `viewed_files` appears zero times in `templates/swagger/v1_json.tmpl`.

**Parity impact**: server-side state that only one client can touch.
A reviewer working partly through an API client and partly in the browser sees the two disagree about which files they have already read, and review progress cannot be reported by any external tool.

**Patch sketch**: add `GET` and `PUT /repos/{owner}/{repo}/pulls/{index}/viewed-files`, the `PUT` taking a `{path: viewed-state}` map exactly as the web handler does today.
The model calls are already isolated in the web handler and lift cleanly.

**Prior art**: open issue [#32898](https://github.com/go-gitea/gitea/issues/32898), "expansions to the pull review API" (December 2024), which asks verbatim for "POST endpoints to mark files as viewed/unviewed" as part of a broader review-API wishlist — also covering PATCH review, PATCH/DELETE review comments, and reply-to-review.
The author offered to submit PRs; none materialised.
That issue is the natural home for finding 2 as well, and commenting on it may be more productive than opening two fresh issues.
Several open UI-side requests exist around viewed-files ([#32267](https://github.com/go-gitea/gitea/issues/32267), [#35401](https://github.com/go-gitea/gitea/issues/35401)) but none has an API dimension.

---

### 9. Label-set initialization is web-only

**Class**: missing route.

**Web**: `POST /{owner}/{repo}/labels/initialize` → `InitializeLabels` (`routers/web/repo/issue_label.go`), registered at `routers/web/web.go:1397`.

**Capability reached**: `repo_module.InitializeLabels(ctx, repoID, labelTemplate, isOrg)` (`modules/repository/init.go:121`), which applies a named label template such as Default or Advanced.

**Current API**: narrower than it first appears, and the framing matters.
Two thirds of this capability already exist: `GET /label/templates` and `GET /label/templates/{name}` enumerate the shipped sets (`routers/api/v1/api.go:1039-1040`), and `CreateRepoOption.IssueLabels` (`modules/structs/repo.go:151`, "Label-Set to use") applies one at repository *creation* time.
What is missing is applying a template set to an **already-existing** repository — the web's `/labels/initialize` action.

**Swagger evidence**: `labels/initialize` appears zero times in `templates/swagger/v1_json.tmpl`, while the template-read routes are present.

**Parity impact**: real but modest, and the weakest finding here.
Automation that adopts an existing repository — or re-standardises labels across many repositories after the fact — must read the template via the API it already has, then create each label with an individual call, reimplementing a loop Gitea performs server-side.

**Patch sketch**: add `POST /repos/{owner}/{repo}/labels/initialize` taking `{"template_name": "Default"}` and calling `repo_module.InitializeLabels` (`modules/repository/init.go:121`) directly.
No new discovery endpoint is needed — `GET /label/templates` already covers it.
The org-label equivalent could take the same treatment in the same patch, since the function already carries an `isOrg` flag.

**Prior art**: none for the apply-to-existing-repo action.
Merged PR [#24602](https://github.com/go-gitea/gitea/pull/24602) (May 2023) added the read-only template endpoints, and merged PR [#6061](https://github.com/go-gitea/gitea/pull/6061) added the creation-time option — cite both rather than claiming the capability is absent, or the finding will be dismissed on its first sentence.

---

## Appendix: ready-to-paste issue drafts

Drafts for the five findings at the top of the *filing* order rather than the severity ranking — those are the ones to open first.
Findings 6 and 8 are deliberately absent: both should be comments on existing issues (#6454 and #32898), not new ones.
Re-verify the commit reference before pasting if upstream has moved.

### Draft — finding 4 (time estimate)

> **Title**: API can read `time_estimate` but cannot set it
>
> The issue API exposes `time_estimate` in its responses — added in #35475, which also wired it into webhooks — but there is no way to set it through the API.
> `EditIssueOption` has no time-estimate field and no dedicated route exists.
>
> The web UI does this via `POST /{owner}/{repo}/{type}/{index}/time_estimate` (`UpdateIssueTimeEstimate` in `routers/web/repo/issue_timetrack.go`), which calls `issue_service.ChangeTimeEstimate` (`services/issue/issue.go`).
>
> The practical effect is that round-tripping an issue through the API silently drops its estimate, and any planning or import tool has to leave estimates empty. #35475 appears to have implemented the read half of this field; I would like to complete it.
>
> Proposal: add `TimeEstimate *int64` to `EditIssueOption` and call the existing service function from `EditIssue`, matching how `deadline` and `ref` are already handled. Happy to submit a PR.

### Draft — finding 7 (review comment attachments)

> **Title**: API cannot attach files to pull request review comments
>
> #29220 added attachment support for code review comments and gave `pull_service.CreateCodeComment` an `attachments []string` parameter, which the web form passes through.
> The API never does: `CreatePullReviewComment` in `modules/structs/pull_review.go` has only `Path`, `Body`, `OldLineNum` and `NewLineNum`, so API-created review comments always pass a nil attachment list.
>
> This is inconsistent with the rest of the API, which supports attachments on issues and issue comments through the `/assets` routes.
>
> Proposal: add an `Attachments []string` field to `CreatePullReviewComment` and to `CreatePullReviewCommentReplyOptions`, passed through in `CreatePullReview` and `CreatePullReviewCommentReply`. The upload route already exists; this only carries the resulting UUIDs. Happy to submit a PR.

### Draft — finding 3 (`invalidated` on review comments)

> **Title**: `PullReviewComment` does not expose whether a comment is outdated
>
> `issues_model.Comment` carries an `Invalidated` field, set when the line a review comment refers to no longer exists in the diff. The web UI uses it to hide outdated comments behind a toggle.
> The API's `PullReviewComment` struct does not expose it, so consumers listing review comments cannot distinguish live feedback from comments stranded by a subsequent push.
>
> Relatedly, the struct has no explicit `resolved` boolean — `resolver != nil` is currently the only way to infer resolution, which #15167 introduced without a corresponding flag.
>
> Proposal: add `invalidated` (and optionally `resolved`) to `PullReviewComment`, populated in `ToPullReviewComment` in `services/convert/pull_review.go` alongside the existing `Resolver` assignment. Happy to submit a PR.

### Draft — finding 1 (merge blockers) — post as a comment on #13879

> This is still open and still reproduces on current main.
>
> The API returns a single `mergeable` boolean with no reason attached. The web UI's merge box computes considerably more: `pullMergeBoxData` in `routers/web/repo/pull.go` carries `isBlockedByApprovals`, `isBlockedByRejection`, `isBlockedByOfficialReviewRequests`, `isBlockedByOutdatedBranch` and `isBlockedByChangedProtectedFiles`, plus status-check and required-signing state. All of it is reachable only from `ViewPullMergeBox`.
>
> The consequence for any merge-automating consumer — CI bots, merge queues, dashboards — is that it can see *that* a PR is unmergeable but never *why*, so it must either re-implement branch-protection logic client-side against several other endpoints or fail with no explanation.
>
> Would maintainers accept a `GET /repos/{owner}/{repo}/pulls/{index}/merge_status` returning the structured blockers? That would need the blocker computation extracted from the web layer into `services/pull` first, leaving `ViewPullMergeBox` a thin caller. Adding the fields to `PullRequest` directly seems worse, since it would cost the computation on every list read.

### Draft — finding 2 (pending review accumulation) — post on #32898 or as a new issue

> The API cannot add a code comment to an existing pending review.
>
> `POST /repos/{owner}/{repo}/pulls/{index}/reviews` creates its comments and then calls `pull_service.SubmitReview` in the same request, so the entire review must be assembled in one request body. The web UI does not work this way: `POST /{owner}/{repo}/pulls/{index}/files/reviews/comments` with `single_review=false` accumulates comments into the doer's open pending review, submitted later.
>
> To be clear about what this is *not*: #36683 added replies to already-posted comments and explicitly skips creating pending reviews, and #36903 was a different design for the same threading problem. Neither addresses accumulating a draft review.
>
> The effect is that a client walking a diff file by file — how both humans and automated reviewers work — must buffer every comment in its own memory, with no server-side draft to recover if the final submit fails.
>
> Proposal: `POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id}/comments`, validating that the review belongs to the doer and is pending, then calling `pull_service.CreateCodeComment` with `pendingReview=true`. The service function already accepts every argument needed; this is routing and validation only.
