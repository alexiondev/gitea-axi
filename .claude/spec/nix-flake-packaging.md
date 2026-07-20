## Problem Statement

The maintainer runs NixOS and wants gitea-axi installed declaratively through the system configuration, alongside every other tool on the machine.

Today there is no declarative path.
gitea-axi is distributed only as an npm package, and nothing has been published yet — there are no release tags and no tarball on the registry.
Installing it means an imperative global npm install, which sits outside the system configuration, is invisible to rollbacks, and drifts from the rest of the machine's declarative state.

The repository also has no declarative development environment.
It carries no Nix expression, no direnv configuration, and no Node version file, while documenting a build, a live end-to-end tier, and a benchmark harness that all assume a Node toolchain the repository never specifies.
The continuous integration workflow pins Node 20, which reached end-of-life in April 2026, so the one place a Node version *is* named now names an unsupported one.

## Solution

A Nix flake at the repository root that exposes gitea-axi as a package, so the maintainer's NixOS configuration can add it to the system package set the same way it adds anything else.

The flake also exposes a development shell carrying the toolchain the repository actually needs — Node, `git`, and `tea` — giving `nix develop` a declarative answer to "what do I need to work on this".
A checks output makes `nix flake check` build the package and run its tests, so the flake itself is verifiable rather than silently rotting.

Because gitea-axi discovers credentials by shelling out to `tea`, and drives repositories by shelling out to `git`, the installed binary is wrapped so both are reachable from the Nix closure.
The wrapper defers to the operator's own binaries when present, and supplies the closure's only as a fallback.

Alongside the flake, the continuous integration workflow moves off end-of-life Node, tests the full range of Node versions the package claims to support, and gains the two test tiers it currently never runs.

## User Stories

1. As the maintainer, I want gitea-axi available as a flake package, so that I can install it from my NixOS configuration instead of through an imperative global npm install.
2. As the maintainer, I want the installed binary to find `git` and `tea` without my having to install them separately, so that the tool works on a fresh machine with no manual setup.
3. As the maintainer, I want my own `tea` to be the one gitea-axi invokes when I have one, so that a single `tea` version owns the credential store it reads and writes.
4. As the maintainer, I want the flake to build without my maintaining a dependency hash, so that bumping an npm dependency does not also require an edit to the Nix expression.
5. As the maintainer, I want the package version taken from the package manifest, so that a released version and its store path can never disagree.
6. As the maintainer, I want the Nix build to run the fast test tier, so that a package that builds is also a package whose behavior was checked.
7. As the maintainer, I want the Nix build to drive the binary it just installed, so that a broken executable bit or a misplaced bundled Agent Skill fails the build instead of failing on first use.
8. As the maintainer, I want the build to depend only on files that can change its output, so that writing an ADR or landing a benchmark result does not trigger a rebuild and a full test run.
9. As the maintainer, I want a development shell with Node, `git`, and `tea`, so that `nix develop` gives me the toolchain for the build, the live end-to-end tier, and the benchmark harness.
10. As the maintainer, I want the development shell and the packaged binary to share one Node reference, so that development and the shipped artifact cannot drift onto different major versions.
11. As the maintainer, I want `nix flake check` to actually build and test, so that the conventional health-check command is not a silent no-op.
12. As the maintainer, I want continuous integration to build the flake, so that I learn a build-relevant file was omitted from the source filter at the commit that caused it rather than weeks later at my next system rebuild.
13. As the maintainer, I want continuous integration to run on supported Node versions only, so that I am not gating merges on a runtime that receives no security fixes.
14. As the maintainer, I want the declared engine range to match the versions actually tested, so that the compatibility promise in the manifest is verified rather than asserted.
15. As the maintainer, I want the benchmark harness tier to run in continuous integration, so that harness logic is guarded rather than relying on my remembering its non-default runner configuration.
16. As the maintainer, I want the packaging tier to run in continuous integration, so that a broken distribution artifact is caught before a manual publish rather than by whoever installs it.
17. As the maintainer, I want the assertions about an installed binary to be written once and driven by both the npm install path and the Nix install path, so that the two distribution methods cannot drift apart in what they guarantee.

## Implementation Decisions

### Flake surface

The flake exposes a package, a development shell, and a checks output.
It deliberately exposes no NixOS module and no overlay.

A NixOS module was rejected because gitea-axi is a stateless CLI with no daemon and no system-level configuration; a module would wrap the system package set and nothing else.
An overlay was rejected as an interface with no consumer — the maintainer is the sole consumer and already knows the package goes into the system package set.
Both remain purely additive to add later.

A home-manager module is explicitly deferred rather than rejected.
The one piece of per-user state is the Agent Skill that the `setup` command installs, and a module managing it declaratively would reintroduce exactly the automatism that ADR 0009 rejected when it chose an explicit `setup` command over a postinstall script.
That trade-off deserves its own decision, made with usage evidence.

Consumers deduplicate nixpkgs by pointing the flake's nixpkgs input at their own.
Consequently the flake's own nixpkgs input governs only standalone builds, the development shell, and flake checks — never the deployed artifact.
That input tracks the unstable channel, matching the maintainer's system, so the development shell reflects the same package set the installed binary is built against.

System coverage is the four common Linux and Darwin targets, enumerated with a small helper built from the nixpkgs standard library rather than by taking a dependency on a third-party systems-enumeration flake.
Cross-platform support is close to free because the package contains no compiled code; the only per-system variation is which Node, `git`, and `tea` are pulled in.

### Package expression

The derivation lives in its own expression, separate from the flake, written in the conventional callable form that nixpkgs uses.
This keeps the flake's own file to interface concerns — what it consumes and what it exports — and leaves the derivation buildable outside a flake context, usable in an overlay unchanged, and upstreamable to nixpkgs later.

Dependencies are fetched by deriving each package's fetch from the integrity fields already present in the lockfile, rather than by a single fixed-output derivation keyed on a hash committed to the Nix expression.
The hash-based approach was rejected on maintenance grounds: it breaks on every lockfile change and is repaired by copying a hash out of an error message into the expression, which is a permanent recurring tax and a standing source of stale-hash commits.
The lockfile-derived approach is viable here specifically because every runtime dependency resolves to the public npm registry with an integrity field, there are no git or filesystem dependencies, and the lockfile is version 3.

The package version is read from the package manifest at evaluation time.
The manifest is already the canonical version — the documented release flow bumps it — and hardcoding it in the Nix expression would create a second place to update, whose omission yields a store path labelled with one version containing another's code.

The runtime Node is the nixpkgs default, currently a supported long-term-support release.
Node 20 is not an option: nixpkgs marks it with known vulnerabilities as end-of-life, so using it would require the consuming configuration to permit an insecure package.
The development shell references the same Node attribute as the package, so the two cannot drift.

### Source filtering

The derivation's source is an explicit allowlist of the paths the build and its tests actually read: the TypeScript sources, the test tier, the bundled Agent Skill, the package manifest and lockfile, the two TypeScript configurations, and the default test-runner configuration.

Taking the whole repository was rejected because this repository's highest-churn directories are all build-irrelevant — the ADR, spec, and task directories, the benchmark harness, and the prose documentation.
Under a whole-repository source, writing an ADR invalidates the derivation and forces a full rebuild including the test suite.
A gitignore-derived filter was rejected as insufficient for the same reason: it still admits the benchmark harness, the agent-context directory, and the several additional test-runner configurations.

The cost is that adding a build-relevant top-level file requires updating the allowlist.
That failure is loud and immediate — the build fails on a missing file — but it is disconnected enough from its cause to warrant both a Gotcha entry in the agent instructions and the continuous-integration flake job described below.

### Runtime dependency wrapping

The installed binary is wrapped so that the closure's `git` and `tea` are appended to the operator's existing search path, not prepended.
The operator's own binaries win where present; the closure supplies a fallback so a fresh machine works and the not-installed error path becomes unreachable in practice.

This is the reverse of the hermetic instinct, and the reason is specific to `tea`.
Per ADR 0001 as amended, the token is fetched through `tea`'s git-credential-protocol interface, which refreshes near-expiry OAuth tokens *in place*.
The invoked `tea` therefore writes to the operator's credential store, so prepending would mean two `tea` versions mutating one state file — the maintainer's for interactive login management, the closure's for token refresh.

`git` takes the same treatment for uniformity, after the reproducibility argument for prepending it was examined and rejected as illusory: a pinned `git` still reads the operator's global configuration, so behavior is not actually pinned, while a closure `git` lacking an extension the operator relies on — a filter, a credential helper — would *introduce* the divergence that prepending is meant to prevent.
Replacing the search path outright was rejected for the same reasons in stronger form, plus it would break repository operations over SSH remotes.

`tea` remains a runtime dependency for credential discovery only.
ADR 0002 moved command dispatch to the Gitea REST API but explicitly retained `tea` for auth, and nothing in this work changes that.

### Verification inside the build

The build runs the fast test tier, which requires a real `git` and a `which` in the check inputs because two of its files invoke `git` directly and one resolves `git` by lookup; `tea` is already stubbed within that tier.
The live end-to-end tier and the benchmark smoke tier are excluded because they require a live Gitea host.

After installation, the build drives the wrapped binary through the shared installed-binary tier described under Testing Decisions.
This guards a class of failure the fast tier structurally cannot reach: the compiler does not set the executable bit that npm would otherwise set from the manifest's `bin` entry at install time, and the `setup` command resolves the bundled Agent Skill relative to its own module location, which makes the relative arrangement of the built output and the bundled Skill load-bearing.

The checks output aliases the package, so the conventional flake health-check command builds it and thereby runs both phases.
Granular per-stage checks were rejected: the one stage that would add real coverage is the full typecheck, which spans the test and benchmark directories and would therefore drag the benchmark harness into the derivation's inputs, undoing the source filtering above.
The full typecheck stays in continuous integration, where it already runs.

### Continuous integration

The workflow matrixes over the two supported Node versions and the declared engine range narrows to match.
The current declaration promises support down to Node 20 while testing only Node 20, so the entire claimed range below the tested version is unverified and its floor is end-of-life.
Narrowing the range is free right now because nothing has been published and no tags exist; that window closes at first publish.

The live end-to-end tier runs on the highest matrix leg only, because it exercises the Gitea API contract rather than Node-version behavior, and each leg provisions a full Gitea service.

Two tiers join the workflow.
The benchmark harness tier runs on every leg: it is deterministic, needs no network or agent SDK, and is currently unguarded despite its non-default runner configuration being an easy thing to believe is running when it is not.
The packaging tier runs on the highest leg only, being slow and largely version-independent; it is the only automated guard on the distribution artifact given that publishing is a manual command.

The benchmark smoke tier stays out of continuous integration.
It targets a live host discovered through the maintainer's own credentials and skips cleanly when they are absent, so in continuous integration it would pass by skipping — a green check that verified nothing.

A separate job builds the flake, on both push and pull request.
It is deliberately non-gating for the other jobs, so an infrastructure problem with Nix availability on the runner does not block an otherwise legitimate change.
Its value is detecting flake rot — most concretely, a build-relevant file omitted from the source allowlist — at the commit that causes it rather than at the maintainer's next system rebuild.
Its cost is honest: because the checks output aliases the package, this job re-runs the fast tier inside the derivation and, without a warm store, rebuilds the whole dependency closure.

Release automation stays out of scope.
Automating a publish path that has never once been exercised manually would encode assumptions about a process with no track record, and the artifact-integrity concern that would motivate it is already covered by adding the packaging tier.

## Testing Decisions

A good test here asserts externally observable behavior of an *installed* gitea-axi — that the binary runs, renders, and installs its Agent Skill — and not the mechanics of how it came to be installed.
Nothing should assert on store paths, wrapper script internals, derivation attribute values, or the arrangement of files within the installed tree, because all of those are implementation detail of the packaging method and would have to change in lockstep with it.

### The seam

There is one new seam, and it is a parameterization of an existing tier rather than a new suite.

The packaging tier today contains two kinds of assertion coupled only by a shared setup step: assertions about the shape of the packed tarball and its manifest, and assertions that drive the resulting installed binary.
The second group is parameterized by exactly one value — the path of the binary to drive — and is precisely what the Nix build needs to assert about its own installed output.

That group is therefore split out and taught to accept its binary path from the environment.
When the environment names an already-installed binary, the tier drives it directly and skips the pack-and-install setup; when it does not, the tier packs and installs as it does today and drives the result.
The npm distribution path and the Nix installation path become two callers of one seam.

The tarball-shape assertions remain npm-only, since a Nix installation produces no tarball and no packed manifest.
This split also improves the existing tier on its own terms, by separating two concerns that were only ever joined by an expensive shared setup.

Two alternatives were rejected.
A bespoke shell smoke test in the Nix build would need no TypeScript change and no test runner inside the derivation, but it is a second and weaker seam asserting the same intent, and it would not have caught the bundled-Skill arrangement bug that motivates the check at all.
Running only the fast tier after installation was rejected because it does not exercise the installed layout, which is the entire class of failure the post-install check exists to catch.

### Consequential change to existing assertions

The packaging tier currently asserts that the declared engine range mentions Node 20.
Narrowing the engine range changes that assertion.
It is part of this work rather than a later surprise.

### Prior art

The installed-binary assertions already exist and are the model: they drive a real subprocess, answer its HTTP calls with the in-process fixture server used throughout the suite, and point the `setup` command at a temporary home directory to observe the Agent Skill being written.
Unlike the in-process CLI-seam harness, which keeps the environment fully explicit, this tier deliberately inherits the parent environment because the spawned binary genuinely needs it — that remains true, and is more true under a wrapper.

### Not covered by automated tests

The flake's consumption from a NixOS configuration is verified by the maintainer performing a system rebuild, not by an automated test.
Building the package proves the derivation is correct; whether the maintainer's configuration wires it in correctly is outside this repository.

## Out of Scope

Removing the `tea` runtime dependency.
It was raised and examined during design: ADR 0002 moved command dispatch off `tea` but retained it for credential discovery, and eliminating it would mean either owning a credential store or reading `tea`'s internal configuration format, which ADR 0001 explicitly rejected because it forfeits OAuth token refresh.
Wrapping the binary makes the dependency invisible in practice, which removes most of the practical motivation.

A home-manager module, and with it any declarative management of the Agent Skill or the session-start hook.

An overlay output and a NixOS module output.

A direnv configuration.
The maintainer does not currently run direnv, so committing one would be configuration for a tool that is not installed.

Release and publish automation, and the first publish itself.

Migrating continuous integration to build via Nix.
The workflow keeps its container-and-npm shape, deliberately preserving the GitHub Actions compatibility the workflow documents as a goal; the Nix job is additive.

## Further Notes

### Resolved verification item: the hook records the absolute path under Nix

The `setup` command's hook installation passes the SDK both an absolute path to the running entrypoint and the bare binary name.
The design-time hope was that the SDK prefers search-path resolution and treats the absolute path as a fallback, which would have made this a non-issue.
It was verified against the installed dependency and against a real Nix build, and the answer is the unfavourable one: **under Nix the absolute store path is recorded**, even with the binary on `PATH`.

The SDK's `resolvePortableHookCommand` returns the bare name only when some `PATH` entry *realpath-matches* the entrypoint, and the absolute path otherwise.
That test is what splits the two installation methods, and the split is a property of how each one puts the binary on `PATH`:

- **npm** symlinks the `bin` entry directly at the entrypoint, so the realpath comparison succeeds and the bare name is recorded.
- **Nix** installs the `bin` entry as a *generated wrapper script* that invokes `node <path>` — `nodejsInstallExecutables` inside `npmInstallHook`, plus this package's own `makeWrapper` layer for `git` and `tea`.
  A wrapper's realpath is the wrapper, never the entrypoint, so the comparison cannot succeed and the absolute path is recorded.

So the preference for the bare name is real, but it is unreachable through any wrapper-based install.
It is not that Nix was overlooked; it is that the mechanism keys on a filesystem relationship only the symlink shape has.

The mitigation is therefore documentation, per the decision recorded when this item was opened: the `setup` command's help text states that `setup hooks` must be re-run after an upgrade.
The failure it guards against is silent — a session-start hook that cannot execute simply does not run, so a user gets no error, only the quiet absence of their ambient dashboard.

Changing the `setup` command to prefer the bare name remains a separate task with its own ADR, justified on the grounds that a stable search-path name is more robust for *every* installation method, and explicitly not as a special case that detects Nix store paths in application code.
Two findings feed that future task.
First, the mitigation above is documentation against a silent failure, which is the weakest kind of fix.
Second, a related defect shares the same line: `isManagedHook` recognises its own hook by testing whether the recorded command string *contains* the marker `gitea-axi`, so an entrypoint path lacking that substring makes `setup hooks` append a duplicate rather than update in place, contradicting the idempotency its help text promises.
That coupling is why `package.nix` renames its build tree in `postUnpack`; the rename can be deleted once the hook no longer depends on the entrypoint path.

### Verified during design

The `tea` in nixpkgs carries the credential-helper interface that ADR 0001's amendment depends on, under the singular alias the code uses.
All three runtime dependencies resolve to the public npm registry.
The lockfile is version 3 and the lockfile-derived fetching helper is available.
There are no native modules and no install scripts in the runtime closure.
The reserved self-update command is already shadowed and never writes, so it poses no read-only-store hazard.

### Candidate ADR

The wrapper's deference to the operator's own binaries warrants an ADR.
It is surprising without context, since the hermetic instinct points the other way; it is the product of a real trade-off between reproducibility and single-owner mutable state; and it is hard to reverse in the sense that flipping it can corrupt an operator's credential store rather than merely changing behavior.
