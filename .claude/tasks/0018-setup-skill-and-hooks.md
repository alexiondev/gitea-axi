---
spec: gitea-axi
blocked-by: 0017-dashboard
---

## What to build

Ambient-context distribution: the bundled Agent Skill, the `setup` command, the opt-in `setup hooks`, and the shadowed `update` command (see ADRs 0009 and 0013).
Author the Agent Skill markdown as a minimal pointer, not a command reference: frontmatter description triggering on Gitea issue/PR/label work; a body saying when to use gitea-axi over tea, raw API calls, or git; one-line command-group summaries; and pointers at the bare dashboard and per-command `--help` — the CLI stays the single source of interface truth.
`setup` installs the skill into the user-level skills directory, idempotently reporting installed/updated/unchanged.
`setup hooks` installs a SessionStart hook via axi-sdk-js's `installSessionStartHooks()` for Claude Code, Codex, and OpenCode; the hook runs the bare binary (short dashboard tier) at session start.
`update` shadows the SDK's built-in self-update command, failing with `VALIDATION_ERROR` and a help line pointing at the npm update command, keeping the ten-code error list intact.
There is no postinstall script — skill and hook installation are always explicit user actions.
These commands touch only the local filesystem, not the Gitea API, so their real-integration surface is the CLI seam against a temporary HOME rather than the live-Gitea end-to-end tier — there is no live-Gitea behavior for an e2e test to attest to here.

## Acceptance criteria

- [x] The Agent Skill markdown is bundled in the package and follows the minimal-pointer shape (trigger description, when-to-use, command-group one-liners, discovery pointers)
- [x] `gitea-axi setup` installs the skill and outputs `setup: { skill, path, status }`; re-running reports `updated` or `unchanged` rather than failing
- [x] `gitea-axi setup hooks` registers the SessionStart hook for all three integrations via the SDK and outputs the `hooks:` block with a restart help line; managed entries are updated in place on re-run
- [x] `gitea-axi update` fails with `VALIDATION_ERROR` (exit 2) and the npm update help line; the SDK's `UPDATE_ERROR` never surfaces
- [x] Integration tests drive `setup`, `setup hooks`, and `update` at the CLI seam against a temporary HOME, asserting the real skill file and the three managed hook configs are written and updated in place, and covering the setup idempotency states and the update shadow (this temp-HOME filesystem tier is the applicable real-integration test; these commands make no Gitea API calls, so there is no live-Gitea e2e case)

## Implementation Notes

The bundled skill lives at `skills/gitea-axi/SKILL.md` and ships via a new `"skills"` entry in `package.json`'s `files`.
`src/commands/setup.ts` resolves both the skill source and the CLI entrypoint relative to `import.meta.url` (`../../skills/...` and `../main.js`), so they track the install tree regardless of how the process was launched; the dist layout mirrors `src/`, so the same relative paths resolve under both the built output and the source-run test tier.
`setup` reads `HOME` from the injected env (falling back to `USERPROFILE`, then `os.homedir()`), which is what lets the integration tests drive it against a temporary HOME through the ordinary CLI seam.

`setup hooks` calls the SDK's `installSessionStartHooks()` with an explicit `marker`/`binaryNames`/`execPath`/`homeDir` and `shouldInstall: () => true`.
The unconditional install is deliberate: the SDK's auto-install safety gate is tuned for an inferred `dist/bin/<name>.js` entrypoint, which gitea-axi does not use (its entrypoint is `dist/main.js`), so the default gate would refuse to install. `setup hooks` is an explicit user action, so gating it on the entrypoint layout is inappropriate.
Hook errors from the SDK are collected via `onError` and, if any occur, surfaced as a single thrown error rather than silently swallowed.

`update` is registered as a normal command in `cli.ts`, which shadows the SDK's reserved built-in (the SDK only runs its own `update` when the tool has not registered one); the handler always throws `VALIDATION_ERROR` with the npm-update help line, so the SDK's `UPDATE_ERROR` can never surface.

Deviations / follow-ups:

- **Process deviation:** the implementation was written before the tests this cycle, then tests were authored test-first-style by a sub-agent from the public interface only. The RED step therefore did not produce genuine failures (the code already existed); the tests were confirmed green instead. Assertions were derived from the spec/ADRs as independent literals, not from observed output.
- **Follow-up (out of scope here):** ADR 0009's consequences mention the dashboard suggestion table hinting at `setup` for discoverability. That hint is not among this task's acceptance criteria and would touch task 0017's `dashboard.ts`, so it is left as a follow-up; `setup` is currently discoverable via the top-level `--help`.
