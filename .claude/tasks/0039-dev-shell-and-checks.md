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

- [ ] `nix develop` yields a shell with Node, `git`, and `tea` available.
- [ ] The build, the fast tier, and the benchmark harness's runner all work from inside that shell.
- [ ] The shell's Node and the package's Node come from one reference — changing it moves both, and they cannot be set independently.
- [ ] `nix flake check` builds the package and runs its tests, and fails when the package fails.
- [ ] No per-stage check derivations are added.
