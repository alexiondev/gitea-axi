# fetch-then-patch for additive/subtractive assignee and reviewer mutations

Gitea's PATCH endpoints for issues and PRs replace the entire assignee/reviewer list rather than adding or removing individual entries.
Flags like `issue edit --add-assignee` and `pr edit --add-reviewer` imply additive semantics: "add X to the current list, leave the rest alone."

## Decision

Implement additive and subtractive assignee/reviewer mutations as a fetch-then-patch:
1. Fetch the current entity (`GET .../issues/{index}` or `GET .../pulls/{index}`).
2. Compute the new list by applying the additions and removals to the current list.
3. Send a single PATCH with the resulting full list.

## Considered Options

**Single PATCH with only the new entries** (rejected) — Overwrites the existing list, dropping all current assignees/reviewers not mentioned in the command.
Correct for a "replace all" semantic but wrong for `--add` / `--remove` flags.

**Dedicated add/remove endpoints** (not available) — Gitea has additive label endpoints (`POST .../issues/{index}/labels`) but no equivalent for assignees or reviewers.

**fetch-then-patch** (chosen) — One extra GET per mutation.
Produces correct additive/subtractive semantics.
Accepted cost: same policy as client-side filtering — extra HTTP calls do not factor into design decisions.

## Consequences

- Every `--add-assignee`, `--remove-assignee`, `--add-reviewer`, `--remove-reviewer` call issues one extra GET.
- The operation is not atomic: a concurrent edit between the GET and the PATCH could cause a lost update.
  Accepted as a known limitation for single-agent workflows.
- `issue label --add` / `--remove` does NOT use fetch-then-patch — Gitea has dedicated additive label endpoints that are already idempotent.

## Amendment (2026-07-10): reviewers use dedicated endpoints, not fetch-then-patch

The original decision was wrong about reviewers on two counts:
`EditPullRequestOption` has no reviewers field at all (fetch-then-patch is impossible, not merely chosen against), and Gitea does have dedicated add/remove endpoints — `POST`/`DELETE /repos/{owner}/{repo}/pulls/{index}/requested_reviewers` with `{ reviewers: string[] }`.

`pr edit --add-reviewer` / `--remove-reviewer` therefore use the dedicated review-request endpoints, mirroring the label-mutation pattern.
Fetch-then-patch remains the pattern for assignees only (issues and PRs), where the PATCH body does replace the whole list and no dedicated endpoints exist.
`pr create --reviewer` is unaffected: `CreatePullRequestOption` accepts `reviewers` directly.
