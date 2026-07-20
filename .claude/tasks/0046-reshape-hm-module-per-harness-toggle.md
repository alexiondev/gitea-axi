---
spec: hm-module-harness-integration
---

## What to build

Reshape the home-manager module so that enabling gitea-axi means "install the CLI, always", and the Claude Code agent context follows only when Claude Code is present.

`programs.gitea-axi.enable` installs the binary unconditionally.
The two per-artefact toggles (`skill.enable`, `sessionStartHook.enable`) and the assertion that fired when either was on without `programs.claude-code.enable` are removed, replaced by a single per-harness toggle, `programs.gitea-axi.enableClaudeCodeIntegration`, defaulting to a literal `true`.
When the integration toggle is on, both Claude Code artefacts are declared; they land only when `programs.claude-code.enable` is also on, and are silently absent otherwise, with no assertion — matching how home-manager's own `enableBashIntegration`-style toggles behave against a disabled sibling.

The SessionStart hook stays declared through the Claude Code module's `settings.hooks.SessionStart` option, so it composes with an operator's own hooks and inherits that module's own enable-gate for free.

The Agent Skill moves off `programs.claude-code.skills` and is written through home-manager's own file mechanism, into Claude Code's skills directory under the `gitea-axi` name, sourced from the package's published Skill.
Because it no longer rides the Claude Code module's options, it no longer inherits that module's enable-gate, so the module gates the Skill write explicitly on `programs.claude-code.enable` (in addition to `enable` and the integration toggle).
This explicit gate also keeps package realisation lazy — the file mechanism reads the Skill's source path during evaluation, so an ungated write would realise the package on every host.
The module comments the resulting asymmetry: the Skill gated by an explicit sibling-enable condition, the hook by the sibling module's own gate.

Writing the Skill as an ordinary file declaration at its own path (rather than as a contribution to the skills option's type) fixes the path-form collision at its root: it composes with both the attribute-set and whole-directory forms of an operator's own `programs.claude-code.skills`.

`programs.gitea-axi.package` is unchanged in meaning, including the `package = null` path, which declares the Skill and hook from the default build without installing the binary.

INSTALL.md is updated to match the new option surface: the options table, the `package = null` paragraph, and the removal of the path-form skills limitation paragraph (the limitation no longer exists).

## Acceptance criteria

- [x] `programs.gitea-axi.enable = true` puts the binary on the operator's packages regardless of whether Claude Code is enabled.
- [x] `skill.enable`, `sessionStartHook.enable`, and the assertion are gone; `programs.gitea-axi.enableClaudeCodeIntegration` exists and defaults to a literal `true` (not derived from `programs.claude-code.enable`).
- [x] Enabling gitea-axi on a host with `programs.claude-code.enable = false` evaluates successfully and installs no Skill and no hook — no assertion failure.
- [x] With `enableClaudeCodeIntegration` and `programs.claude-code.enable` both on, the Skill is written through home-manager's file mechanism into Claude Code's skills directory under `gitea-axi`, and the hook is declared through `programs.claude-code.settings.hooks.SessionStart`.
- [x] The Skill write is gated on `programs.claude-code.enable` explicitly so the package's Skill source is not realised on a host without Claude Code; the hook has no such explicit gate and the asymmetry is commented.
- [x] `package = null` still declares the Skill and hook from the default build without adding the binary to the operator's packages.
- [x] INSTALL.md's options table and `package = null` paragraph reflect the new surface, and the path-form skills limitation paragraph is removed.

## Implementation Notes

The module reads Claude Code's skills location from `config.programs.claude-code.configDir` rather than hardcoding `.claude/skills`, mirroring the sibling module exactly so the Skill lands beside Claude Code's own skills wherever the operator points that option.
Confirmed against the current home-manager `claude-code` module: it lowers a path-form skills directory to a *recursive* `home.file` install (individually-linked files under `configDir/skills`), which is what lets the module's own `configDir/skills/gitea-axi` entry coexist as a sibling.
Task 0047 turns that coupling into an automated check.

The asymmetric gating the spec calls for is expressed structurally: the hook is declared under `enableClaudeCodeIntegration` alone and relies on the Claude Code module's own `mkIf enable` to drop it when disabled; the Skill adds a nested `mkIf claudeCode.enable` because writing through `home.file` does not inherit that gate, and the gate additionally keeps package realisation lazy.
The asymmetry is commented in the module.

Verified by evaluating the real module through `home-manager.lib.homeManagerConfiguration` (the same seam task 0047 automates) under four configurations: both-on (binary + Skill file + hook in settings), Claude Code off (binary only, no Skill, no assertion failure), integration off (binary only, no Skill, no hook), and `package = null` with Claude Code on (Skill declared, gitea-axi absent from `home.packages`).
All matched.

Task 0047 (the flake check and home-manager input) is staged in the same commit as an untracked planning artifact but is implemented separately.
