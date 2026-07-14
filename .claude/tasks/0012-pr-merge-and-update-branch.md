---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

`pr merge` and `pr update-branch`.
`pr merge <n>` supports `--method` with all six Gitea methods (`merge`, `squash`, `rebase`, `rebase-merge`, `fast-forward-only`, `manually-merged`), the three common-method shorthands (`--merge`, `--squash`, `--rebase`), `--auto`, `--delete-branch`, `--body`/`--body-file`, `--subject`, and `--merge-commit-id`.
`--merge-commit-id` is required with `--method manually-merged` and rejected with any other method — both violations are `VALIDATION_ERROR` before any API call, as are conflicting shorthands.
Idempotent: an already-merged PR returns `pull_request: { number, state: "merged", merged_by, merged_at }` without calling the merge API.
Merge-blocked conditions surface through the standard 405/409 → `VALIDATION_ERROR` mapping with the server's message and remediation help lines.
`pr update-branch <n>` merges the base branch into the PR head via the update endpoint with `--style <merge|rebase>` (default merge).

## Acceptance criteria

- [x] `--method` accepts all six methods and the shorthands map to their methods; conflicting or duplicate action flags yield `VALIDATION_ERROR` (exit 2) before any API call
- [x] `--merge-commit-id` without `manually-merged`, or `manually-merged` without `--merge-commit-id`, both yield `VALIDATION_ERROR` locally
- [x] Successful merge outputs `merged: { number, status: "ok", method }`
- [x] An already-merged PR short-circuits to the entity block with `merged_by` and `merged_at`, exit 0, no merge API call
- [x] A 405 not-mergeable response surfaces as `VALIDATION_ERROR` with help suggesting `pr update-branch <n>` or `pr checkout <n>`
- [x] `pr update-branch <n> --style rebase` calls the update endpoint with the style param and outputs `updated: { number, status: "ok" }`
- [x] Fixture-server tests cover each method, the local validations, the idempotent no-op, and the 405/409 mappings

## Implementation Notes

**No merge method given → `Do: merge` on the wire, `method: default` in the output.**
Gitea's merge endpoint requires a concrete `Do`, so with no `--method`/shorthand the command sends the baseline `merge` while reporting `method: "default"`.
The reported field describes the caller's choice (none was made), matching the gh-axi interface's documented shape; it is not a seventh merge method.
A consequence worth flagging: a repository configured to disallow plain merge commits (e.g. squash-only) will reject a bare `pr merge` with a 405, which surfaces with the server's message.
Respecting the repo's `default_merge_style` on the no-method path (an extra repo GET) is a possible follow-up if that turns out to bite.

**Conflicting/duplicate method flags share one message.**
Any combination of more than one method selector (`--method`, `--merge`, `--squash`, `--rebase`) yields a single `VALIDATION_ERROR`: `Choose only one merge method (--method, --merge, --squash, or --rebase)`.
The gh-axi interface doc lists three separate strings (multiple shorthands, `--method`+shorthand, invalid value); the combined message covers the first two cases in one and reads at least as clearly, and the task's own criteria only require `VALIDATION_ERROR` before any API call.

**`--merge-commit-id` remediation and 405/409 handling.**
`manually-merged` is reachable only through `--method` (it has no shorthand), so the `--merge-commit-id` pairing check can never collide with a shorthand.
Merge-blocked 405/409 responses reuse `classifyHttpError`'s `VALIDATION_ERROR` mapping (preserving the server's message) but swap in two remediation help lines pointing at `pr update-branch <n>` and `pr checkout <n>` — the latter lands in task 0014, so the suggestion currently names a command that does not exist yet.
