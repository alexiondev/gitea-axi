---
spec: nix-flake-packaging
blocked-by: [0036-parameterized-installed-binary-tier, 0037-flake-package-and-wrapper]
---

## What to build

After it installs, the Nix build drives the wrapped binary it just produced through the shared installed-binary tier, pointing that tier at the installed path rather than letting it pack and install.

This guards a class of failure the fast tier structurally cannot reach.
The compiler does not set the executable bit that npm would otherwise set from the manifest's `bin` entry at install time.
And the `setup` command resolves the bundled Agent Skill relative to its own module location, which makes the relative arrangement of the built output and the bundled Skill load-bearing — an arrangement that only exists once installed.

The check reuses the seam from the parameterized tier; it does not introduce a second, weaker set of assertions in shell script, and it does not re-run the fast tier, which would not exercise the installed layout at all.

## Acceptance criteria

- [x] The Nix build drives the installed binary through the shared installed-binary tier after installation.
- [x] A binary installed without its executable bit fails the build.
- [x] A bundled Agent Skill installed at the wrong location relative to the built output fails the build.
- [x] The post-install phase adds no assertions of its own beyond pointing the shared tier at the installed binary.
- [x] `nix build` still succeeds end to end on a clean checkout.

## Implementation Notes

### Where the check hangs

`installCheckPhase`, not `postInstall`.
It runs after `fixupPhase`, which is where `wrapProgram` has already done its work — so the binary the tier drives is the wrapped one an operator actually gets, not the bare entrypoint.
The phase sets `GITEA_AXI_INSTALLED_BIN=$out/bin/gitea-axi` and runs `npm run test:installed`, a new script that runs the installed-binary facet alone under the packaging runner configuration.
Naming the binary is all it does; the assertions stay in the tier, satisfying the fourth criterion by construction.

`vitest.packaging.config.ts` had to join the source allowlist in `package.nix` — exactly the Gotcha task 0037 recorded, hit on the first build.

### Dev dependencies are gone by install time

`npmInstallHook` runs `npm prune --omit=dev` against the build tree's `node_modules` during `installPhase`, so vitest no longer exists when `installCheckPhase` runs.
`preInstall` snapshots the tree with `cp -al` first — hardlinks, so it costs neither time nor space, and the prune's deletions do not follow through to the copy — and the check restores it.
Restoring copies rather than moves, so a replayed phase (`--keep-failed` debugging) does not consume the only surviving snapshot.
Recorded as a Gotcha, since the failure is disconnected from its cause.

### Criterion 2 holds, but by a different mechanism than the task assumed

The task motivates the executable-bit guard with "the compiler does not set the executable bit that npm would otherwise set from the manifest's `bin` entry".
That is true of the npm path and *not* of the Nix path: `nodejsInstallExecutables` installs each `bin` entry as a generated wrapper invoking `node <path>`, not as a symlink to the entrypoint.
So `chmod -x` on `dist/main.js` changes nothing — verified, the build stayed green — while `chmod -x` on `$out/bin/gitea-axi` fails all three tests with `EACCES`.

The criterion as written is therefore satisfied, and was demonstrated by probe, but the bit it protects under Nix is one `makeWrapper` always sets.
The assertion earns its keep on the npm caller, where the failure the task describes is real.
This is an argument for the shared tier rather than against it: neither installation path gets to pick which guarantees it feels like offering.
Both mechanism and probe results are recorded as a Gotcha.

The Skill-location criterion is the one doing real work under Nix — moving the installed `skills` directory aside fails the `setup` test and the build.

### Two defects found and fixed in passing

Both were surfaced by the review pass rather than planned.

`test:installed` pins a test file by path, and the packaging runner sets `passWithNoTests: true`.
Renaming or moving that file would have made vitest match nothing, exit 0, and take `nix build` green having asserted nothing — the same silently-inert trap that `doCheck` sprang in task 0037.
The script now passes `--passWithNoTests=false`.

`nix build --rebuild` reported the derivation "may not be deterministic".
The cause predates this task: `checkPhase`'s vitest leaves a run cache at `node_modules/.vite/…/results.json` recording durations and timestamps, and `npmInstallHook` copies `node_modules` into `$out` wholesale — so every build shipped a stray cache in the closure and no two outputs matched.
`checkPhase` now removes it, and `--rebuild` passes.
Strictly this belonged to 0037, but this task adds a second vitest run over the same surface, and the fix is one line in a file already being edited.

### Scope note

`.gitignore` gains `result` / `result-*`.
That is 0037's flake output rather than this task's, but the symlink appears the moment anyone runs `nix build` without `--no-link` and was already showing up as untracked.
