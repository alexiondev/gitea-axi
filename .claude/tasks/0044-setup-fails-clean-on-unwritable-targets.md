---
spec: nix-flake-packaging
---

## What to build

Report an unwritable target as an error the user can act on, instead of crashing.

Both halves of `setup` assume the files they manage are writable.
When they are not — because a configuration manager owns them, because a file is flagged immutable, because the path is root-owned — the skill install raises a raw filesystem error with no handling at all, and the hook install surfaces the underlying message through its error collector without saying what a reader should do about it.

Neither failure is exotic.
Any tool that manages a user's agent configuration declaratively renders these paths read-only, and gitea-axi's own Nix install method encourages exactly that arrangement.

The error names the file and the condition, and points at the general remedy: the file appears to be managed elsewhere, so the skill or hook should be declared through that configuration rather than installed by this command.

It deliberately does not guess at the cause.
Read-only is not diagnostic of any particular manager, and naming one would be wrong for most users who hit this.

The failure follows the CLI's existing error convention rather than inventing a shape, so it carries a code and help lines like every other error the tool reports.

## Acceptance criteria

- [ ] An unwritable skill target produces a structured CLI error rather than an unhandled filesystem exception.
- [ ] An unwritable hook target produces the same class of error, with the same guidance.
- [ ] Both errors name the file that could not be written and state that it appears to be managed by another tool.
- [ ] Neither error names or infers a specific configuration manager.
- [ ] A skill target that is unwritable but already byte-identical to the bundled copy succeeds rather than failing, since nothing needs to be written.
- [ ] The errors carry a code and help lines consistent with the rest of the CLI's error surface.
