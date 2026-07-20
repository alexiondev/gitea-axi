---
spec: nix-flake-packaging
blocked-by: 0037-flake-package-and-wrapper
---

## What to build

Two further flake outputs, so `nix develop` gives a declarative answer to "what do I need to work on this" and `nix flake check` is not a silent no-op.

The development shell carries the toolchain the repository actually needs: Node, `git`, and `tea` — enough for the build, the live end-to-end tier, and the benchmark harness, all of which the repository documents while specifying no toolchain anywhere.
It references the same Node attribute as the package, so development and the shipped artifact cannot drift onto different major versions.

The checks output aliases the package, so the conventional health-check command builds it and thereby runs both its verification phases.
Granular per-stage checks are deliberately not added: the one stage that would add real coverage is the full typecheck, which spans the test and benchmark directories and would therefore drag the benchmark harness into the derivation's inputs, undoing the source filtering.
The full typecheck stays in continuous integration, where it already runs.

## Acceptance criteria

- [x] `nix develop` yields a shell with Node, `git`, and `tea` available.
- [x] The build, the fast tier, and the benchmark harness's runner all work from inside that shell.
- [x] The shell's Node and the package's Node come from one reference — changing it moves both, and they cannot be set independently.
- [x] `nix flake check` builds the package and runs its tests, and fails when the package fails.
- [x] No per-stage check derivations are added.

## Implementation Notes

### The single Node reference is a `passthru`, not a second `pkgs.nodejs`

The shell takes `self.packages.${system}.gitea-axi.nodejs` rather than naming `pkgs.nodejs` again.
Naming it twice would satisfy the criterion's letter while leaving two places to edit, which is the drift the criterion exists to prevent; reading it back off the derivation means there is genuinely one reference.

The first cut relied on `buildNpmPackage` incidentally surfacing its `nodejs` argument as a derivation attribute — which works, but only as a side effect of `inherit src nodejs`, with nothing marking it load-bearing.
Review caught that: moving or dropping that `inherit` would have broken the shell silently at a distance.
`package.nix` now declares `passthru = { inherit nodejs; };`, making it an interface with a comment saying what depends on it.
`passthru` does not enter the derivation, so the store path is unchanged and the change costs no rebuild — verified: the drv hash before and after is identical.

### `curl` was a missing part of the toolchain

The benchmark's `raw-api` arm shells out to `curl` (`ARM_BINARY` in `bench/guard.ts`), so the shell carries it alongside Node, `git`, and `tea`.

### The shell deliberately does not supply `gitea-axi`

The criterion asks that the benchmark harness's runner work from inside the shell, and it does.
A *live* arm run is a further step the shell cannot take: `provisionArmBin` resolves each arm's binary by name off `PATH`, and the `gitea-axi` arm's binary must be the locally built `dist/main.js` so a run measures the working tree rather than whatever the flake last packaged.
Putting the packaged binary on `PATH` would satisfy the lookup with the wrong artifact — a silently misleading benchmark, worse than a missing one.

Exposing the *built* one was considered and rejected as well: `tsc` does not set an executable bit on `dist/main.js` (npm sets it at install time from the manifest's `bin` entry, which is what the packaging tier's bit assertion guards), so a `shellHook` would have had to `chmod +x` the build output on every shell entry — mutating build artifacts to work around a lookup that is the benchmark's own concern.
Both the flake and the CLAUDE.md gotcha now state the boundary rather than implying the shell covers it.

### CLAUDE.md's toolchain gotcha was stale by construction

It read "the repository has no dev shell yet (task 0039 adds one)".
This slice is that task, so the entry was rewritten to point at `nix develop --command`, keeping `nix shell nixpkgs#nodejs -c ...` only as the one-off outside the repository.
