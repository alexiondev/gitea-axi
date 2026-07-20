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

- [x] An unwritable skill target produces a structured CLI error rather than an unhandled filesystem exception.
- [x] An unwritable hook target produces the same class of error, with the same guidance.
- [x] Both errors name the file that could not be written and state that it appears to be managed by another tool.
- [x] Neither error names or infers a specific configuration manager.
- [x] A skill target that is unwritable but already byte-identical to the bundled copy succeeds rather than failing, since nothing needs to be written.
- [x] The errors carry a code and help lines consistent with the rest of the CLI's error surface.

## Implementation Notes

The condition is `EACCES`, `EPERM`, or `EROFS` — the three ways a filesystem refuses a write for a reason the user has to settle outside this tool.
The new `TARGET_NOT_WRITABLE` code joins the spec's enumerated list, alongside a paragraph describing it.

Two things came out of review and go slightly beyond the literal criteria.

The skill half now guards its comparison read as well as its write.
A target the filesystem will not let us read is one it will not let us replace either — the same condition reached one call earlier — so a mode-`000` file reports the same error rather than the raw exception the criteria were written against.

The hook half collects its failures as `{path, detail}` records rather than the agent SDK's flattened `<path>: <message>` text.
The SDK reports through a string, so the two halves are separated once at that boundary and judged apart.
This matters for correctness, not just shape: testing the whole formatted string for an errno would misclassify an unrelated failure whose *path* happened to contain `EACCES`.

Two known limits, both judged acceptable rather than fixed.

The hook error names the target the SDK was writing, which is the intended path rather than necessarily the blocking one — if `~/.claude` were unwritable and `settings.json` absent, it would name the file rather than the directory.
The SDK discards the error object, so its `path` is not recoverable; the skill half, which catches its own errors, does report the blocking path and is tested for it.

An unwritable `~/.claude/settings.json` still leaves the Codex and OpenCode integrations installed, because the SDK writes them before the failure surfaces.
The command exits 1 having done part of its work.
Making the hook install transactional across three integrations owned by the SDK is a larger change than this task, and re-running after fixing the permission converges correctly.
