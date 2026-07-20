---
spec: nix-flake-packaging
---

## What to build

Resolve the spec's one open verification item, then act on what is found.

The `setup` command's hook installation passes the agent SDK both an absolute path to the running entrypoint and the bare binary name.
Under Nix the absolute path is content-addressed: it changes on every rebuild and is eventually garbage-collected, so a hook that records it would break silently — a session-start hook that cannot execute simply does not run.
The bare binary name strongly suggests the SDK prefers search-path resolution and treats the absolute path as a fallback, which would make this a non-issue, but that could not be confirmed during design because the dependency was not installed.

The decision is to verify before acting.
Determine, against the installed SDK, which of the two the hook installation actually records.

If it prefers the bare name, record the finding and close the item — no code changes.
If it records the absolute path, the immediate mitigation is documenting that the hook setup should be re-run after an upgrade.
Changing the `setup` command to prefer the bare name is explicitly **not** part of this task: it would become a separate task with its own ADR, justified on the grounds that a stable search-path name is more robust for *every* installation method, and explicitly not as a special case that detects Nix store paths in application code.

## Acceptance criteria

- [x] The SDK's actual hook-path behavior is determined by observation against the installed dependency, not inference from its interface.
- [x] The finding is recorded where a future reader will meet it, so the question is not re-opened from scratch.
- [x] If the absolute path is recorded, the documentation states that hook setup must be re-run after an upgrade.
- [x] No change is made to how the `setup` command constructs the hook in this task.

## Evidence gathered during task 0037

Task 0037 built the flake, which made the SDK's behaviour directly observable.
The answer is the unfavourable one: **the absolute path is recorded**, so the mitigation branch of this task applies, not the close-the-item branch.

`resolvePortableHookCommand` in `axi-sdk-js` returns the bare binary name only when a `PATH` entry realpath-matches the entrypoint, and the absolute path in every other case.
Driving the Nix-built binary writes this into `~/.claude/settings.json`:

```
/nix/store/nmkzjny0hpzjvyxzdz189whk605di8b6-gitea-axi-0.1.0/lib/node_modules/gitea-axi/dist/main.js
```

That path is content-addressed, so it changes on every rebuild and is eventually garbage-collected, and the session-start hook then silently stops running.

A second defect surfaced from the same line.
`isManagedHook` recognises its own hook by testing whether the recorded command *string contains* the marker `"gitea-axi"`, so when the entrypoint path lacks that substring, `setup hooks` appends a duplicate entry instead of updating in place — contradicting the idempotency its help text promises.
This is reproducible outside Nix: copy the checkout to a path containing no `gitea-axi` segment and `test/setup.test.ts` fails.

Consequences for this task:

- Both defects trace to the same resolution line, so they should be weighed together.
- The stale store path is user-facing breakage on the install method task 0037 added, which argues for not letting this drift far behind it.
- `package.nix` carries a `postUnpack` rename of the build tree purely to work around the substring coupling. It is commented as a workaround and should be **deleted as part of this task**, once the hook no longer depends on the entrypoint path.

## Implementation Notes

### The observation

Task 0037's evidence was re-verified independently rather than taken on trust, since acceptance criterion 1 asks for observation and not for citation.
Two observations were made against the installed dependency.

A probe drove `resolvePortableHookCommand` directly with two synthetic install trees.
Given a `PATH` entry that is a *symlink* to the entrypoint it returned the bare name `gitea-axi`; given a `PATH` entry that is a *wrapper script* invoking `node <entrypoint>` it returned the absolute path.
Then the flake was built and the resulting binary driven for real against a temporary `HOME`.
With `$out/bin` on `PATH`, `~/.claude/settings.json` recorded:

```
/nix/store/pqxhyy5cg1rljyn78kxfpxyfpgz7rgzk-gitea-axi-0.1.0/lib/node_modules/gitea-axi/dist/main.js
```

This confirms 0037's finding and sharpens it.
The task framed the bare name as a hint that the SDK "prefers search-path resolution"; that preference is real, but it is gated on a `PATH` entry whose realpath equals the entrypoint.
npm satisfies that by symlinking its `bin` entry; Nix cannot, because `nodejsInstallExecutables` generates a wrapper script and this package adds a second `makeWrapper` layer for `git` and `tea`.
So the behaviour is not Nix-specific — it applies to *any* wrapper-based install — which strengthens the case, already recorded, that the eventual fix belongs in the `setup` command for every installation method rather than as a Nix special case.

### Deviations

**The `postUnpack` rename in `package.nix` was kept, not deleted.**
The "Evidence gathered during task 0037" section above says it "should be **deleted as part of this task**", which conflicts with acceptance criterion 4 and with the "What to build" section's statement that changing the hook to prefer the bare name is "explicitly **not** part of this task".
The conflict resolves on the Evidence section's own wording: the deletion is conditioned on "once the hook no longer depends on the entrypoint path", and establishing that precondition is exactly the out-of-scope change.
Deleting the rename now would leave the derivation's build tree at a path with no `gitea-axi` segment, which `isManagedHook`'s substring test still requires, and `test/setup.test.ts` would fail inside `checkPhase`.
The rename's comment was rewritten instead: it previously promised that task 0042 would remove the coupling, which would have become a stale forward reference the moment this task landed.

**The documentation surface is the `setup` help text.**
The repository has no README, so the command's own help is the only place a user meets this.
Criterion 4 is untouched — `binaryNames`, `execPath`, and the `installSessionStartHooks` call are all unchanged; only the `usage` string moved.

**One sentence beyond the strict ask.**
The help text asserted "Both are idempotent" unqualified, which the finding recorded in this same commit makes false for the duplicate-append case.
Leaving a statement the commit itself documents as untrue seemed worse than a one-line caveat, so the new paragraph notes that a stale entry may survive a re-run.

### Follow-up

The successor task is described in the spec's Further Notes but not yet written as a task file.
It should carry its own ADR and cover both defects together, since both trace to the same resolution line: the absolute-path recording, and `isManagedHook` recognising its hook by substring.
Deleting `package.nix`'s `postUnpack` rename belongs to it.
