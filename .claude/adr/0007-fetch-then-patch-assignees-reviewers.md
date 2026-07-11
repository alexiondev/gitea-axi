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
