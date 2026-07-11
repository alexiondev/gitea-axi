---
spec: gitea-axi
---

## What to build

The tracer bullet: a runnable `gitea-axi` npm package whose first command, a minimal `issue list`, works end-to-end — argv in, TOON out — against both the fixture server and a real Gitea instance.
Scaffold the project on axi-sdk-js (`runAxiCli`, `AxiError`, `exitCodeForError`, output helpers) with gitea-js as the sole HTTP layer, ESM on Node 20+.
Implement repository context detection from the git `origin` remote (SSH and HTTPS forms), tea credential discovery via `tea login list --output json` with the three-way login-matching split, and the `-R`/`--repo` and `--login` context override flags with their env equivalents (priority: flag > env > auto-detection).
Implement the full error classification table (ten AxiError codes, HTTP status + path-based 404 mapping, TOON error output to stdout, exit codes 0/1/2).
Implement test mode (`GITEA_AXI_API_URL` + `GITEA_AXI_TOKEN` + `GITEA_AXI_REPO`) and the fixture server, with Vitest as the runner.
`issue list` itself stays minimal in this slice: `--state` and `--limit` only, default fields (`number`, `title`, `state`, `author`, `created`), count line from `X-Total-Count`, explicit empty state, `type=issues` guard, and a next-step suggestion block.

## Acceptance criteria

- [x] `gitea-axi issue list` returns a TOON list with default fields `number`, `title`, `state` (lowercased), `author`, `created` (relative time), preceded by a `count: N of T total` line
- [x] `--state <open|closed|all>` (default open) and `--limit <n>` (default 30) work
- [x] Every issues-list API call passes `type=issues`, so PRs never appear in issue lists
- [x] Empty result emits `issues[0]: (none)` plus a next-step suggestion, never silent output
- [x] Every command run appends at least one `help[N]:` next-step suggestion
- [x] Repo owner, name, and hostname are detected from the git `origin` remote in both SSH and HTTPS forms; no recognizable remote yields `REPO_NOT_FOUND`
- [x] Credentials come from `tea login list --output json`; missing tea binary yields `TEA_NOT_INSTALLED`, zero logins yields `AUTH_REQUIRED`, no hostname match yields `REPO_NOT_FOUND`, ambiguous multi-match without a default yields `VALIDATION_ERROR` listing profile names
- [x] `-R`/`--repo` and `--login` flags (accepted anywhere on the command line) and `GITEA_AXI_REPO`/`GITEA_AXI_LOGIN` env vars override auto-detection with flag > env > auto priority; suggestions include the override flags only when context did not come from the git remote
- [x] A nonexistent `--login` profile name yields `VALIDATION_ERROR` listing available profiles
- [x] Errors are TOON-encoded to stdout as `error:` + `code:` + optional `help[N]:`, classified per the spec's status table (401→`AUTH_REQUIRED`, 403→`FORBIDDEN`, path-based 404 split, 405/409/422→`VALIDATION_ERROR`, 429→`RATE_LIMITED`, other→`UNKNOWN`)
- [x] Exit codes: 0 on success, 1 on error, 2 on `VALIDATION_ERROR` including unknown flags
- [x] `--help` on the root and on `issue list` prints a concise flag reference and exits 0; no command ever prompts interactively
- [x] Setting `GITEA_AXI_API_URL` + `GITEA_AXI_TOKEN` + `GITEA_AXI_REPO` suppresses the git and tea subprocesses and routes all HTTP to the fixture server
- [x] Vitest tests drive the CLI seam (argv in, stdout/exit-code out) against the fixture server for the happy path, empty state, and at least one error classification per category exercised here

## Implementation Notes

**Token discovery deviates from the letter of the spec and original ADR 0001.**
`tea login list --output json` factually carries no token — its columns are only `name`, `url`, `ssh_host`, `user`, `default` (verified against tea 0.14.2 and tea main).
The list output is still used for login discovery and the three-way matching split; the token for the selected login comes from `tea login helper get --login <name>` (tea's git-credential interface, which also refreshes OAuth tokens in place).
ADR 0001 was amended in this change; the spec's Auth paragraph ("extracts the token") still reflects the old assumption and should be updated — left untouched here because the spec file carries unrelated pending edits.

**404 classification is slightly broader than the spec table.**
The spec maps 404 on `/repos/{owner}/{repo}` itself to `REPO_NOT_FOUND` and "other paths" to `UNKNOWN`.
Gitea returns 404 for every path under a nonexistent repository, so a 404 on a repo-subtree path that is not an indexed `/issues/{n}` or `/pulls/{n}` lookup (e.g. the issue-list endpoint itself) is classified `REPO_NOT_FOUND` rather than `UNKNOWN`.
Without this, `issue list -R bad/repo` would report `UNKNOWN`, which defeats the code's self-correction purpose.

**Login hostname matching compares hostnames, ignoring ports.**
A login matches when its URL hostname or its `ssh_host` equals the remote's hostname.
SSH remotes (like this repo's own `ssh://gitea@git.alexion.dev:2022/...`) use a different port than the login's HTTPS URL, so port-inclusive matching would never match.

**A minimal home view exists as a placeholder.**
`runAxiCli` requires a `home` handler; bare `gitea-axi` currently prints the SDK header, a `repo:` line, and a `help:` block.
Task 0017 replaces it with the real two-tier dashboard.
Similarly, the SDK's built-in `update` command remains unshadowed until task 0018.

**Global flags are extracted before the SDK parses argv.**
`runAxiCli` rejects any flag placed before the command, so `-R`/`--repo`/`--login` are pulled out of argv first (satisfying "accepted anywhere"); all other leading flags still exit 2 via the SDK's own error.

**Other notes.**
`GITEA_AXI_API_URL` is the instance base URL without `/api/v1` (gitea-js appends it); the fixture server serves `/api/v1/...` paths.
The SDK's `renderError` helper is not exported from the axi-sdk-js package index (contrary to ADR 0004's summary), so `src/render.ts` builds the identical error TOON locally.
The bin entry guards against EPIPE so `gitea-axi | head` exits quietly instead of crashing.
Tests drive the CLI seam in-process via `runCli({ argv, env, cwd, stdout })` — the same function the binary calls — with a fully explicit environment; context-detection tests use real `git` repos plus a fake `tea` script on a sandboxed `PATH`.
