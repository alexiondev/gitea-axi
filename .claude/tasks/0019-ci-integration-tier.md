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

- [x] A workflow runs on push/PR on Gitea Actions, executing the unit and integration tiers (the local vitest suite) and the end-to-end tier
- [x] The disposable Gitea runs as a service container pinned to a specific stable image tag
- [x] End-to-end tests provision their own repo, token, and seed data on the disposable instance, then assert real CLI output and exit codes for at least the tracer command set
- [x] The workflow uses only syntax that works verbatim (or near-verbatim) on GitHub Actions
- [x] A fixture-vs-live divergence in a covered response shape fails the end-to-end tier

## Implementation Notes

**Tier split.**
The end-to-end tier lives under `test/e2e/` with its own `vitest.e2e.config.ts` and a `test:e2e` npm script; the default `vitest.config.ts` now excludes `test/e2e/**` so `npm test` stays the fast unit+integration tiers with no external dependency.
The e2e suite is gated on `GITEA_AXI_E2E_URL` via `describe.skipIf`, so it skips cleanly (exit 0) when no live instance is configured; `passWithNoTests` guards against a "no tests found" failure in that state.

**In-Node provisioning, no `docker exec`.**
`test/e2e/provision.ts` brings a fresh Gitea to a usable state entirely over HTTP: it waits on `GET /api/v1/version`, registers the first user through the web `sign_up` form (Gitea makes the first account the site admin), scraping and echoing the double-submit CSRF token, then mints a scoped API token via HTTP Basic auth and creates the repo + seed issues with it.
This keeps provisioning identical on Gitea Actions, GitHub Actions, and a developer's local `docker run gitea/gitea`, with no container-shell access required.

**Portable networking.**
The workflow job runs inside a `node:20-bookworm` container so the `gitea` service container is reachable by service name (`gitea:3000`) on both Gitea Actions and GitHub Actions, sidestepping the host-`localhost` vs. service-name difference between the two platforms — this is what keeps the file near-verbatim GitHub-compatible (AC4).

**Fixture-vs-live guard (AC5).**
Rather than hardcode expected keys, the shape guard anchors on one exported contract, `COVERED_ISSUE_PATHS` — the exact dotted paths the issue-list `FieldDef` extractors read — and asserts it holds on *both* the recorded `fixtures/issues-open.json` and the live response.
A drift in either (a fixture edited out of shape, or a live field renamed such as `user`→`author`) fails the tier.

**Pinned tag.**
`gitea/gitea:1.23.5`, chosen to match the gitea-js client line (`^1.23.0`) so the e2e tier exercises the response shapes the client was generated against; bumped deliberately by the operator.

**Deviation from the letter of the ACs.**
The workflow adds a `typecheck` step that no AC names; it is cheap CI hygiene and kept deliberately.

**Verified against a live Gitea 1.23.5.**
The full e2e tier was run against a real disposable `gitea/gitea:1.23.5` container (all seven tests green), which also confirms the pinned tag pulls.
The live run surfaced one thing the earlier mock run could not: creating a repo under a user (`POST /user/repos`) requires the token scope `write:user` on Gitea 1.23, not `write:repository` — the token scopes in `provision.ts` were corrected to `["write:user", "write:repository", "write:issue"]`.
This is exactly the fixture-vs-live class of divergence the tier exists to catch.
