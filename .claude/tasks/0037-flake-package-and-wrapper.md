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

- [x] Building the flake's package from a clean checkout produces a runnable `gitea-axi` that prints help and reports its version.
- [x] The store path's version matches the package manifest's version, with the version appearing in no Nix expression.
- [x] Changing a dependency in the lockfile requires no edit to any Nix expression.
- [x] The derivation is a separate callable expression that the flake file consumes; it evaluates outside a flake context.
- [-] The package builds for the four supported Linux and Darwin systems, with no third-party flake input beyond nixpkgs.
- [x] Touching a file outside the source allowlist — an ADR, a spec, a benchmark file, prose documentation — does not change the derivation's output path.
- [x] The wrapped binary finds `git` and `tea` on a machine where neither is otherwise installed.
- [x] With the operator's own `git` and `tea` on the search path, those are the ones the binary invokes.
- [x] The fast test tier runs and passes inside the build; a deliberately failing test fails the build.
- [x] ADR 0018 is committed as part of this slice.
- [x] The agent instructions carry a Gotcha about extending the source allowlist for new build-relevant files.

## Implementation Notes

### Three systems, not four — `x86_64-darwin` is gone

The one dropped criterion. nixpkgs 26.11, which `nixos-unstable` now points at, has removed `x86_64-darwin` support outright.
`legacyPackages.x86_64-darwin` *throws* on evaluation rather than merely failing to build, so enumerating it would break `nix flake show` and `nix flake check` for **every** system at once, not just that one.
The flake therefore covers `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`, with the omission commented at the `systems` list.
Intel macOS would need the 26.05 branch; nobody is asking for it.
The rest of the criterion holds: nixpkgs is the only flake input.

### `doCheck = true` was silently doing nothing

`buildNpmPackage` wires config, build, and install hooks but supplies **no check hook**, so `doCheck` alone is inert.
The first green build logged `no Makefile or custom checkPhase, doing nothing` and produced a package whose tests had never run — a passing build that verified nothing.
The fix is an explicit `checkPhase`, plus `git` and `which` in `nativeCheckInputs` and a writable `HOME`.
Recorded as a Gotcha, since the failure mode is a *green* build.

The second half of that criterion was demonstrated unintentionally but genuinely: with the check phase live, a failing test failed the build with exit code 1 before anything was installed.

### The build tree is named, and why that is a workaround

`postUnpack` renames the build tree from the builder's generic `source` to `gitea-axi`.

This is not cosmetic. `test/setup.test.ts` asserts that `setup hooks` updates its managed entry in place rather than appending a duplicate.
The SDK recognises its own hook by testing whether the recorded command *string contains* `"gitea-axi"`, and the recorded command is the entrypoint's absolute path whenever PATH resolution does not match it — which it never does under vitest, since the entrypoint resolves to `src/main.js`, a file that does not exist.
So the assertion holds only when the checkout's path happens to contain `gitea-axi`.

That was verified rather than assumed: copying the repository to `/tmp/clean-probe-9d3/proj` and running the tier reproduces the failure outside Nix entirely.
A first probe under the session scratchpad passed and was misleading — that path contains `-home-alexion-wrk-gitea-axi-…`, so it satisfied the substring by accident.

The rename makes the build environment representative of a real installation (`node_modules/gitea-axi/…` under npm, `…-gitea-axi-<version>/…` under Nix) rather than an arrangement no operator ever has.
It is a workaround for a defect, not a property worth keeping, and is commented as such.

### Follow-up for task 0042 — the open verification item is answered, unfavourably

The spec's open verification item asked whether the SDK prefers the bare binary name over the absolute entrypoint path.
It does not.
`resolvePortableHookCommand` returns the bare name only when a `PATH` entry realpath-matches the entrypoint, and the absolute path otherwise.

Driving the Nix-built binary shows what actually lands in `~/.claude/settings.json`:

```
/nix/store/nmkzjny0hpzjvyxzdz189whk605di8b6-gitea-axi-0.1.0/lib/node_modules/gitea-axi/dist/main.js
```

That is content-addressed: it changes on every rebuild and is eventually garbage-collected, and a `SessionStart` hook that cannot execute simply does not run.
So the dashboard stops appearing after an upgrade, silently and with nothing pointing at the cause — the exact failure the item hoped to rule out, now confirmed under the install method this slice adds.

Two findings for 0042, both tracing to the same line:

1. The stale store path above — user-facing breakage, and the more serious of the two.
2. `setup hooks` appends a duplicate entry instead of updating in place whenever the entrypoint path lacks the marker.

Both were left alone deliberately, at the maintainer's direction, to keep this slice about packaging; fixing hook resolution here would have pre-empted 0042's design work with a decision made in passing.
When 0042 lands, the `postUnpack` rename should be removed with it.

### ADR 0018

Already committed in `0cbfe43` during the planning pass, ahead of this branch, so the criterion is satisfied by an earlier commit rather than by this one.
No change was needed; `package.nix` implements it via `--suffix PATH`.
