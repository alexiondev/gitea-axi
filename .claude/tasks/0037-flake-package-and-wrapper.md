---
spec: nix-flake-packaging
---

## What to build

A Nix flake at the repository root exposing gitea-axi as a package, so the maintainer's NixOS configuration can add it to the system package set the way it adds anything else.
Building the package and running the resulting binary is the demoable outcome of this slice.

The derivation lives in its own expression, separate from the flake, in the conventional callable form nixpkgs uses.
The flake's own file stays limited to interface concerns — what it consumes and what it exports — leaving the derivation buildable outside a flake context and usable in an overlay unchanged.
The flake exposes only the package for now; the development shell and checks output arrive in a later slice, and no NixOS module or overlay is exposed at all.
Its nixpkgs input tracks the unstable channel, matching the maintainer's system; consumers deduplicate by pointing that input at their own, so it governs only standalone builds.
Systems coverage is the four common Linux and Darwin targets, enumerated with a small helper built from the nixpkgs standard library rather than a third-party systems-enumeration flake input.

Dependencies are fetched by deriving each package's fetch from the integrity fields already in the lockfile, not from a single fixed-output hash committed to the expression — the latter breaks on every lockfile change and is repaired by copying a hash out of an error message, which is a permanent recurring tax.
The package version is read from the package manifest at evaluation time, so a released version and its store path can never disagree.
The runtime Node is the nixpkgs default; Node 20 is not an option, as nixpkgs marks it end-of-life with known vulnerabilities.

The derivation's source is an explicit allowlist of the paths the build and its tests actually read — the TypeScript sources, the test tier, the bundled Agent Skill, the package manifest and lockfile, the two TypeScript configurations, and the default test-runner configuration.
Taking the whole repository, or a gitignore-derived filter, would let the highest-churn and entirely build-irrelevant directories invalidate the derivation and force a full rebuild with tests.

The installed binary is wrapped so the closure's `git` and `tea` are **appended** to the operator's existing search path, never prepended or substituted — ADR 0018 records why, and this slice lands that ADR.
The operator's own binaries win where present; the closure supplies a fallback so a fresh machine works with no manual setup.

The build runs the fast test tier, which needs a real `git` and a `which` available to it because some of its files invoke `git` directly and one resolves it by lookup.
The live end-to-end and benchmark smoke tiers are excluded — they require a live Gitea host.

The allowlist's failure mode is loud but disconnected from its cause, so this slice also records a Gotcha in the agent instructions: a new build-relevant top-level file must be added to the source allowlist or the Nix build fails on a missing file.

## Acceptance criteria

- [ ] Building the flake's package from a clean checkout produces a runnable `gitea-axi` that prints help and reports its version.
- [ ] The store path's version matches the package manifest's version, with the version appearing in no Nix expression.
- [ ] Changing a dependency in the lockfile requires no edit to any Nix expression.
- [ ] The derivation is a separate callable expression that the flake file consumes; it evaluates outside a flake context.
- [ ] The package builds for the four supported Linux and Darwin systems, with no third-party flake input beyond nixpkgs.
- [ ] Touching a file outside the source allowlist — an ADR, a spec, a benchmark file, prose documentation — does not change the derivation's output path.
- [ ] The wrapped binary finds `git` and `tea` on a machine where neither is otherwise installed.
- [ ] With the operator's own `git` and `tea` on the search path, those are the ones the binary invokes.
- [ ] The fast test tier runs and passes inside the build; a deliberately failing test fails the build.
- [ ] ADR 0018 is committed as part of this slice.
- [ ] The agent instructions carry a Gotcha about extending the source allowlist for new build-relevant files.
