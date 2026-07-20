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

- [x] The installed-binary assertions live separately from the tarball-shape assertions, and both still run under the packaging tier's own runner configuration.
- [x] An environment variable naming an existing binary makes the installed-binary group drive that binary and skip pack-and-install.
- [x] With that variable unset, the group packs, installs, and drives the result as before — the default developer experience is unchanged.
- [x] The full packaging tier passes in both modes.
- [x] No assertion in the installed-binary group depends on how the binary was installed.

## Implementation Notes

`test/packaging/packaging.test.ts` split into `tarball.test.ts` and `installed-binary.test.ts`, with the shared `npm pack` / extract / global-install mechanics factored into a non-test `npm-artifact.ts` module beside them.
The runner configuration is untouched apart from its comments: its `include` glob already matched the whole directory, so both new files run under it unchanged.

The environment variable is `GITEA_AXI_INSTALLED_BIN`, matching the existing `GITEA_AXI_*` convention.
An empty value counts as unset, so exporting it blank behaves the same as not exporting it.
A path that does not exist fails in `beforeAll` with an explanatory message rather than letting every assertion fail on an opaque spawn `ENOENT`.

Two deviations from the plan, both minor and both deliberate:

The single `it` that drove the installed binary became three — usage, dashboard render, and Agent Skill installation.
The task said the assertions "do not change in character", and they do not; this only splits one case into the three behaviours the spec itself names ("the binary runs, renders, and installs its Agent Skill"), so a failure names which one broke.

`PUBLISHING.md`'s "Verifying the packed artifact" section was rewritten to describe the two facets and document the new variable.
Not an acceptance criterion, but the section described the tier as one undifferentiated thing and would otherwise have been left stale by this change.

Verified by running the full tier three ways: with the variable unset (both facets pack as before), with it pointing at a separately installed binary (the installed-binary facet skipped its setup — 2.2s down to 0.3s, with no `prepack` build), and with it set to the empty string (falls back to pack-and-install).

One consequence worth flagging for task 0038: the two facets now each run `npm pack`, so `npm run test:pack` builds twice.
That is invisible to the Nix build, which will run only `test/packaging/installed-binary.test.ts` against its own installed output rather than the full tier.
