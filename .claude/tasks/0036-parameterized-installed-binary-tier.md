---
spec: nix-flake-packaging
---

## What to build

The packaging tier today holds two kinds of assertion joined only by an expensive shared setup step: assertions about the shape of the packed tarball and its manifest, and assertions that drive the resulting installed binary.
Split them, and teach the second group to accept the path of the binary to drive from the environment.

When the environment names an already-installed binary, the tier drives that binary directly and skips the pack-and-install setup entirely.
When it does not, the tier packs and installs exactly as it does today and drives the result.
This makes one seam that both the npm distribution path and — later — the Nix installation path call, so the two cannot drift apart in what they guarantee about an installed gitea-axi.

The tarball-shape assertions stay npm-only, since a Nix installation produces no tarball and no packed manifest.

The assertions themselves do not change in character: they drive a real subprocess, answer its HTTP calls with the in-process fixture server used throughout the suite, and point the `setup` command at a temporary home directory to observe the Agent Skill being written.
This tier deliberately inherits the parent environment, unlike the in-process CLI-seam harness — the spawned binary genuinely needs it.

Nothing may assert on store paths, wrapper internals, or the arrangement of files within the installed tree; those are implementation detail of the installation method.

## Acceptance criteria

- [ ] The installed-binary assertions live separately from the tarball-shape assertions, and both still run under the packaging tier's own runner configuration.
- [ ] An environment variable naming an existing binary makes the installed-binary group drive that binary and skip pack-and-install.
- [ ] With that variable unset, the group packs, installs, and drives the result as before — the default developer experience is unchanged.
- [ ] The full packaging tier passes in both modes.
- [ ] No assertion in the installed-binary group depends on how the binary was installed.
