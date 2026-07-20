# Install the Agent Skill via an explicit `setup` command, not npm postinstall

gitea-axi fulfills AXI Principle 7 (Ambient context) through a `setup` subcommand that copies the bundled Agent Skill markdown into `~/.claude/skills/`.
There is no postinstall script.

## Considered Options

**npm postinstall script** (rejected) — The original spec draft had `postinstall` drop the skill file automatically.
pnpm blocks lifecycle scripts by default and npm users increasingly install with `--ignore-scripts`, so the skill would silently fail to install for those users with no signal.
A package install silently writing into `~/.claude/` is also the exact pattern security tooling flags.
Finally, the canonical principle text asks for installation "from an explicit setup command" — postinstall is implicit.

**`setup` command** (chosen) — Matches gh-axi's command surface (its `cli.ts` registers `setup`), matches the canonical principle wording, works under pnpm and `--ignore-scripts`, and makes the `~/.claude/` write an explicit user action.
Discoverable via dashboard help suggestions.

**Both** (rejected) — Two install paths to test, and the postinstall path retains all its failure modes.

## Consequences

- `npm install -g gitea-axi` delivers the CLI only; the skill requires a one-time `gitea-axi setup`.
- `setup` is idempotent: re-running reports already-installed/updated rather than failing.
- The dashboard suggestion table hints at `setup` so agents and operators discover it.

## Addendum (2026-07-10): opt-in `setup hooks`

Canonical Principle 7 makes SessionStart hooks the primary ambient-context mechanism, and gh-axi ships `setup hooks` via axi-sdk-js's `installSessionStartHooks()` (Claude Code, Codex, OpenCode).
gitea-axi adds the same opt-in `setup hooks`; the skill remains the default `setup` action.

Hooks are not the default because the hook runs the dashboard in every session in every directory, and outside a Gitea repo the dashboard errors with `REPO_NOT_FOUND` — a graceful exit-0 degradation was considered and rejected in favor of keeping the error explicit, so hook noise in non-Gitea sessions is an accepted consequence for users who opt in.
The SDK registers the bare binary as the hook command, so the hook always runs the short dashboard tier (see ADR 0012).

**Amended by [ADR 0019](0019-hook-records-search-path-name.md):** that last sentence held only for npm installs.
The SDK records the bare name only when a `PATH` entry realpath-matches the entrypoint it is handed, which npm's symlinked `bin` satisfies and a wrapper-based install cannot.
`setup hooks` now resolves the binary on `PATH` itself and hands that location over, so the bare name is recorded for wrapper-based installs too; the absolute entrypoint path remains the fallback when the name resolves to no install of ours.
