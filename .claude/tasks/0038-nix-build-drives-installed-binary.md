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

- [ ] The Nix build drives the installed binary through the shared installed-binary tier after installation.
- [ ] A binary installed without its executable bit fails the build.
- [ ] A bundled Agent Skill installed at the wrong location relative to the built output fails the build.
- [ ] The post-install phase adds no assertions of its own beyond pointing the shared tier at the installed binary.
- [ ] `nix build` still succeeds end to end on a clean checkout.
