---
spec: hm-module-harness-integration
blocked-by: 0046-reshape-hm-module-per-harness-toggle
---

## What to build

Add the first automated proof of the module's composition, so that a change in home-manager or the Claude Code module that breaks the way the Skill is declared fails `nix flake check` rather than a maintainer rebuild weeks later.

A home-manager input is added to the flake, with its own nixpkgs following the flake's nixpkgs, so the module is checked against the same nixpkgs-and-home-manager pairing a consumer following this flake would get.

A flake check evaluates the actual module through home-manager's standalone configuration entry point and builds the resulting home files derivation under several configurations, asserting on the tree it produces.
Building the home files derivation is sufficient — it is the file-linkage layer that actually decides whether two declarations collide — and needs neither the Claude Code binary nor a running agent.
The check asserts on which files a generation contains, never on module internals (option values, store paths, the shape of the file mechanism).

The configurations exercised:

- An operator declaring their own skills as an attribute set: the module's Skill lands alongside the operator's, each at its own name.
- An operator declaring their own skills as a whole directory (path form): the module's Skill lands alongside the operator's directory contents.
  This is the case that guards the recursive-install coupling; a regression to a non-recursive path-form install fails here as a build-time file collision.
- Claude Code disabled: no gitea-axi Skill entry is written.
  This guards the explicit sibling-enable gate introduced in the reshape.
- The hook merges into an operator's own SessionStart hook list rather than replacing it.

This adds a module check alongside the existing package check in the flake's `checks` output rather than introducing a new kind of verification surface.

## Acceptance criteria

- [x] The flake has a home-manager input whose nixpkgs follows the flake's nixpkgs; `flake.lock` is updated.
- [x] A new check under the flake's `checks` output evaluates the real module through home-manager's standalone configuration entry point and builds the home files derivation — no Claude Code binary or running agent required.
- [x] The attribute-set-skills configuration asserts the module's Skill and the operator's skill both land, each at its own name.
- [x] The whole-directory-skills (path form) configuration asserts the module's Skill lands alongside the operator's directory contents; a non-recursive path-form install would fail this as a build-time collision.
- [x] The Claude-Code-disabled configuration asserts no gitea-axi Skill entry is written.
- [x] A configuration with an operator's own SessionStart hook asserts the module's hook merges into that list rather than replacing it.
- [x] The check asserts on the generation's file tree only, not on option values or store paths.
- [x] `nix flake check` runs the new check across the flake's systems and passes.

## Implementation Notes

The check lives in its own file, `checks/home-manager-module.nix`, imported from the flake's `checks` output beside the existing package check; the `forAllSystems` callback now destructures `{ pkgs, system }` because the check needs `pkgs` to build fixtures and the derivation.
`home-manager` is added as a flake input with `inputs.nixpkgs.follows = "nixpkgs"`; it is a check-only development input with no bearing on the package or the module a consumer imports, and the comment in `flake.nix` says so.

Each of the four configurations builds `config.home-files` — the home-manager file-linkage layer — and the final `runCommandLocal` asserts on that tree with `test`/`grep` only: skill files present or absent by path, and the two SessionStart commands present as quoted JSON string values in `settings.json`.
The hook-merge assertion reads generated file content because that is the only place a list merge is observable; the spec's Testing Decisions name "the hook merges into the operator's own hooks" as a required assertion, so this stays within "assert on the file tree, not on option values or store paths".

On the cross-system criterion: `nix flake check` builds the check for the host system and passes, and omits the incompatible systems (`aarch64-*`) with a warning — identical per-system semantics to the pre-existing package check, which also builds only natively.
The check is import-from-derivation-bearing (the Claude Code module reads the fixture skill directories at evaluation time), so evaluating a foreign system's check forces a cross-platform fixture build rather than skipping cleanly; this is not exercised by the default `nix flake check` and does not affect the native run.

Verified by `nix flake check` (passes, all outputs) and by inspecting each configuration's built `home-files` tree directly: the disabled-Claude-Code generation contains no `.claude` directory at all, and the merged-hook `settings.json` contains both hooks in the `SessionStart` array — confirming the assertions are not vacuous.
