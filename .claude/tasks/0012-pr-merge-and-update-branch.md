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

- [ ] `--method` accepts all six methods and the shorthands map to their methods; conflicting or duplicate action flags yield `VALIDATION_ERROR` (exit 2) before any API call
- [ ] `--merge-commit-id` without `manually-merged`, or `manually-merged` without `--merge-commit-id`, both yield `VALIDATION_ERROR` locally
- [ ] Successful merge outputs `merged: { number, status: "ok", method }`
- [ ] An already-merged PR short-circuits to the entity block with `merged_by` and `merged_at`, exit 0, no merge API call
- [ ] A 405 not-mergeable response surfaces as `VALIDATION_ERROR` with help suggesting `pr update-branch <n>` or `pr checkout <n>`
- [ ] `pr update-branch <n> --style rebase` calls the update endpoint with the style param and outputs `updated: { number, status: "ok" }`
- [ ] Fixture-server tests cover each method, the local validations, the idempotent no-op, and the 405/409 mappings
