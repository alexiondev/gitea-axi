---
spec: gitea-axi
blocked-by: 0001-scaffold-and-issue-list-core
---

## What to build

The end-to-end tier of the test suite: a CI workflow that runs the local vitest suite plus end-to-end tests against a live disposable Gitea instance, verifying that fixture recordings remain accurate and the full HTTP pipeline works.

This project's test taxonomy has three tiers (recorded here because the committed spec's two-tier wording is frozen):

- **Unit tests** — functions within a single file, no I/O (e.g. `parseRemoteUrl`, `relativeTime`).
- **Integration tests** — functionality across files, driven at the CLI seam (argv in, stdout/exit-code out) against the fixture server; what the spec's "Two-tier test strategy" calls the "local / unit tier".
- **End-to-end tests** — the same CLI seam against a live disposable Gitea instance; what the spec calls the "CI integration tier". This task builds this tier.

CI runs on Gitea Actions on the operator's instance, with the disposable Gitea as a docker service container pinned to the latest stable image tag (bumped deliberately, not floating).
The end-to-end tests provision what they need on the disposable instance (repo, token, seed issues/PRs) and then exercise the real CLI seam against it.
The workflow file stays GitHub-Actions-compatible so the GitHub mirror can adopt it nearly verbatim later.

## Acceptance criteria

- [ ] A workflow runs on push/PR on Gitea Actions, executing the unit and integration tiers (the local vitest suite) and the end-to-end tier
- [ ] The disposable Gitea runs as a service container pinned to a specific stable image tag
- [ ] End-to-end tests provision their own repo, token, and seed data on the disposable instance, then assert real CLI output and exit codes for at least the tracer command set
- [ ] The workflow uses only syntax that works verbatim (or near-verbatim) on GitHub Actions
- [ ] A fixture-vs-live divergence in a covered response shape fails the end-to-end tier
