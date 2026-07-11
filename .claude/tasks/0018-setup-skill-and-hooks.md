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

## Acceptance criteria

- [ ] The Agent Skill markdown is bundled in the package and follows the minimal-pointer shape (trigger description, when-to-use, command-group one-liners, discovery pointers)
- [ ] `gitea-axi setup` installs the skill and outputs `setup: { skill, path, status }`; re-running reports `updated` or `unchanged` rather than failing
- [ ] `gitea-axi setup hooks` registers the SessionStart hook for all three integrations via the SDK and outputs the `hooks:` block with a restart help line; managed entries are updated in place on re-run
- [ ] `gitea-axi update` fails with `VALIDATION_ERROR` (exit 2) and the npm update help line; the SDK's `UPDATE_ERROR` never surfaces
- [ ] Tests cover the setup idempotency states and the update shadow (hook installation verified against a temp home directory)
