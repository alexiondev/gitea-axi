# Record the SessionStart hook as a search-path name, not an install-tree path

`setup hooks` resolves `gitea-axi` on `PATH` and hands that location to `installSessionStartHooks`, so the recorded hook command is the bare name `gitea-axi`.
When the name resolves nowhere on `PATH`, the module-relative entrypoint is handed over instead and the absolute path is recorded, exactly as before.

A `PATH` entry qualifies only when it resolves to the running entrypoint — a symlink pointing at it, or a generated wrapper naming it — so a same-named binary that is some other program does not count.

`setup hooks` also collapses duplicate managed entries itself, recognising its own hook by the exact command it records rather than by a substring of that command.

## Context

The agent SDK's `resolvePortableHookCommand` returns a bare binary name only when some `PATH` entry *realpath-matches* the entrypoint it is handed, and the absolute path otherwise.
Task 0042 verified that this splits the two installation methods: npm symlinks its `bin` entry straight at `dist/main.js` so the match succeeds, while any wrapper-based install cannot match, because a script that *invokes* a file never resolves *to* that file.

Under Nix the recorded path is content-addressed — it changes on every rebuild and is eventually garbage-collected — and a SessionStart hook that cannot execute does not run and does not warn.

## Considered Options

**Document a re-run after upgrade** (rejected; this was the task 0042 mitigation being replaced) — Documentation against a silent failure is the weakest kind of fix.
It also does not work reliably: the re-run may leave the stale entry behind rather than replacing it, so the help text had to caveat its own remedy.

**Detect store paths in application code** (rejected) — Special-casing Nix in the CLI is the wrong shape.
The problem is not Nix; it is every wrapper-based install — a shim, a launcher, a generated `.cmd`.

**Write the hook files directly, bypassing the SDK** (rejected) — Would duplicate the SDK's handling of three integrations and four files to change one string, and would drift from it on every SDK change.

**Hand the SDK the `PATH` location** (chosen) — The SDK already prefers the search-path name; it was only ever reaching for it from the wrong end.
Resolving the name the way a shell does and handing that over makes the SDK's own realpath test succeed, so the preference becomes reachable for every installation method rather than only for the symlink shape npm happens to use.
Recording a bare name and letting `PATH` resolve it is also the convention for tools writing into user-owned configuration; absolute paths belong in configuration a package manager regenerates.

## Consequences

- The hook survives an upgrade whenever the binary is on `PATH`, so `setup hooks` no longer needs re-running after one, and the help text saying so is gone.
- The absolute path remains the documented fallback for a binary that is not on `PATH` — a source checkout run through `node dist/main.js`, say — where it is the only thing that could work.
- Which command gets recorded now depends on the invoking environment's `PATH`, not only on how the package was installed.
  `PATH` is therefore read from the process rather than from the injected environment, since it must agree with the SDK's own probing.
- A same-named binary on `PATH` that is *not* this program does not qualify.
  The name must resolve to the running entrypoint — by realpath for a symlink, or by the wrapper naming it — or the fallback applies.
  Accepting any file that merely bears the name would make the SDK's realpath test a tautology, since the path handed over would trivially match itself.
- The SDK recognises its managed hook by finding the marker inside the recorded command, which made a re-run append a duplicate whenever the entrypoint path lacked the substring `gitea-axi`.
  `setup hooks` now prunes duplicates by matching the exact command it records, so idempotency no longer depends on the recorded command's shape, and another tool's hook can never be mistaken for ours.
- `package.nix` no longer renames its build tree in `postUnpack`.
  That rename existed only to give the fast tier an entrypoint path containing the marker.
  With the coupling gone the build runs from `/build/source` and the idempotency test passes there, which is what demonstrates the coupling is actually broken.
- ADR 0009's addendum claimed "the SDK registers the bare binary as the hook command".
  That was true only for npm installs; as of this decision it is true for any install whose `PATH` entry resolves to this entrypoint.
  ADR 0009 is amended accordingly.
