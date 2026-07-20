## Problem Statement

The operator runs a NixOS flake that builds every host they own, and wants gitea-axi installed the way every other tool on the host is: its own [[home-manager module]] with its own enable flag, a standalone CLI alongside the other one-module-per-tool entries.
The agent context — the [[Agent Skill]] and the [[SessionStart hook]] — is a separate concern that should follow only when a harness is present, because gitea-axi is a working CLI without a harness and coupling it to Claude Code would turn adopting a different harness later into an unrelated dependency's problem.

The module as first shipped (task 0045, ADR 0020) does not allow that shape without steering it against its grain.
Enabling the Skill or the hook without `programs.claude-code.enable` is an assertion failure, and both toggles default on, so the common case — an operator who wants the CLI and does not use Claude Code — is a build failure that tells them to turn off two toggles.
Reaching the wanted shape means setting the module's `enable` to whatever Claude Code's `enable` is, and then setting `package = null` so the module does not also install a binary the operator is installing itself.
That leaves an option named `enable` that does not mean "gitea-axi is enabled" and a `null` package that does not mean "no package".

There is a second, quieter problem underneath.
The Skill is declared by contributing an attribute to `programs.claude-code.skills`, whose type accepts either an attribute set of skills or a single path standing for a whole skills directory.
An operator who uses the path form cannot have the module's Skill merged in: the two are different branches of the option's type and the module system cannot merge them, so the configuration fails to evaluate.
The module documents this as a limitation and offers a workaround — disable the Skill and place it by hand — which is exactly the hand-copying-that-drifts the bundled Skill exists to prevent.

## Solution

Reshape the module so that enabling gitea-axi means "install the CLI, always", and the agent context follows the harness that is present.

`programs.gitea-axi.enable` installs the binary unconditionally.
A single per-harness integration toggle, `programs.gitea-axi.enableClaudeCodeIntegration`, defaulting on, declares both the Skill and the hook for Claude Code.
Those two artefacts land only when `programs.claude-code.enable` is also on; when it is off they are silently absent, with no assertion, matching how home-manager's own `enableBashIntegration`-style toggles behave against a disabled shell.
An operator who enables gitea-axi on a host without Claude Code gets the CLI and nothing else, which is the honest outcome and today's build failure.

The Skill is declared by writing it through home-manager's file mechanism directly, into Claude Code's skills directory, rather than by contributing to `programs.claude-code.skills`.
This composes with both forms of an operator's own skills option — the attribute-set form and the whole-directory path form — because it never touches that option's type, so the collision disappears at its root rather than being escaped by a toggle.

Because the Skill now rides the module's own file declaration rather than Claude Code's options, it no longer inherits Claude Code's own enable-gate for free, so the module gates the Skill write on `programs.claude-code.enable` explicitly.
The hook continues to be declared through Claude Code's settings option and continues to inherit that module's gate.

A home-manager flake input is added so that `nix flake check` can evaluate the module against real home-manager and prove the composition, replacing the previous position that the module's wiring was verified only by a maintainer rebuild.

## User Stories

1. As an operator, I want `programs.gitea-axi.enable = true` to install the CLI whether or not I use Claude Code, so that enabling a standalone tool does not require me to also run a harness.
2. As an operator without Claude Code, I want enabling gitea-axi to succeed and simply not install any agent context, so that I am not met with a build failure telling me to turn off toggles for a harness I never asked for.
3. As an operator with Claude Code, I want the Skill and the SessionStart hook to appear automatically when I enable gitea-axi, so that the ambient context follows the harness I have without my wiring each piece.
4. As an operator who wants the CLI but manages the agent context myself, I want to turn off the Claude Code integration with a single toggle, so that I keep the binary declaratively while writing the context by hand or with `setup`.
5. As an operator who already declares my own Claude Code skills as a whole directory, I want gitea-axi's Skill to install alongside them, so that adopting the module does not force me to restructure how I manage skills or hand-copy the Skill.
6. As an operator who already declares my own SessionStart hooks, I want gitea-axi's hook merged into mine rather than replacing them, so that composing the module with my configuration adds to it instead of colliding.
7. As an operator installing the binary another way, I want `package = null` to still declare the Skill and hook from the default build, so that a system-wide install keeps the declarative context.
8. As the maintainer, I want the module's composition proven by `nix flake check`, so that a change in home-manager or the Claude Code module that breaks the way the Skill is declared fails a check rather than a rebuild weeks later.
9. As the maintainer, I want a single per-harness toggle whose shape generalises, so that adding Codex or OpenCode later is a sibling toggle rather than a reshaping of the option surface.

## Implementation Decisions

### Option surface

The module keeps `programs.gitea-axi.enable` (install the binary) and `programs.gitea-axi.package` (the package to install, or `null` to declare the context without installing the binary), both unchanged in meaning.

The two per-artefact toggles the first version carried — one for the Skill, one for the hook — are removed and replaced by one per-harness toggle, `programs.gitea-axi.enableClaudeCodeIntegration`, defaulting to `true`.
Granularity is per harness, not per artefact: the two Claude Code artefacts move together under one switch.
The name follows home-manager's own `enableBashIntegration` convention rather than a nested attribute set, so future harnesses read as `enableCodexIntegration` and `enableOpenCodeIntegration` siblings.
Removing the old toggles is free because the module is unreleased — it landed in a single commit and has no consumers to break.

The default is a literal `true`, not a value derived from `programs.claude-code.enable`.
A config-derived default was considered and rejected: it makes the option's declared value depend on a sibling module's config, and the honest gating is better expressed where the artefacts are declared than by shifting the option's default.

There is no central aggregator toggle over all harnesses yet.
It is the analogue of home-manager's `home.shell.enableShellIntegration` and earns its place only once a second harness exists to aggregate over; it can be added additively then, at which point the per-harness toggles change their default from literal `true` to the aggregator without a rename.

### How each artefact is declared

The hook is declared through the Claude Code module's own settings option, unchanged from ADR 0020.
That module owns the settings file wholesale, so writing it directly would collide; declaring through its option lets home-manager's merge semantics compose the module's hook with an operator's own.
This leg of ADR 0020 is sound and is kept.

The Skill is declared by writing it through home-manager's own file mechanism, into Claude Code's skills directory under the `gitea-axi` name, sourced from the package's published Skill.
It is no longer contributed to `programs.claude-code.skills`.
This is the change that fixes the path-form collision: the Skill write is an ordinary file declaration at a distinct path, not a contribution to the skills option's type, so it composes with both the attribute-set and whole-directory forms of that option.

The composition with the whole-directory form depends on the Claude Code module installing a path-form skills directory recursively — that is, as individually-linked files under a real directory, rather than as one symlink at the skills directory itself.
A recursive install leaves the skills directory a real directory into which the module's own nested Skill entry drops as a sibling; a non-recursive one would claim the whole directory as a single link and collide with any nested entry.
The Claude Code module installs recursively today, so the composition holds, and this is a coupling to that module's behaviour that the check below guards.

### Gating and evaluation cost

Because the Skill is declared by the module's own file mechanism rather than through the Claude Code module's options, it does not inherit that module's `enable`-gate.
The module therefore gates the Skill write on `programs.claude-code.enable` itself, in addition to `programs.gitea-axi.enable` and the integration toggle.
Without that gate the Skill would install on a host that has no Claude Code, contradicting the intended semantics, and would additionally force the package to be realised during evaluation on every host — the file mechanism reads the Skill's source path while evaluating, so an ungated declaration pays that realisation cost even where nothing consumes the Skill.
Gating on the sibling's `enable` keeps the realisation lazy: on a host without Claude Code the Skill's source is never read, so nothing is realised.

The hook needs no such explicit gate, because it is declared through the Claude Code module's option and that module already drops and never forces the declaration when it is disabled.
The two artefacts are therefore gated by different mechanisms internally — the Skill by an explicit sibling-enable condition, the hook by the sibling module's own gate — and the module comments the asymmetry.

### `package = null`

The `package = null` path is unchanged in intent.
It declares the Skill and hook from the default build without adding the binary to the operator's packages, for an operator who installs the binary another way, such as a system-wide package set.
The module reads the Skill and hook out of the operator-supplied package when one is given and out of the default build otherwise; that fallback is kept.
Its cost is narrow and was accepted: it is a second evaluation of the same derivation for one path, which reduces to a single build when the operator's system-wide install comes from the same package set, and under the new gating it is reached only when Claude Code is enabled.

### Flake input

A home-manager input is added to the flake, with its own nixpkgs following the flake's nixpkgs, so the module is checked against the same nixpkgs-and-home-manager pairing a consumer following this flake would get.
This reverses ADR 0020's position that the flake takes no home-manager input and the module is verified only by a maintainer rebuild.
The reversal is justified by the check below, which is the first automated verification of the module's composition — a thing a rebuild proves only after the fact and only on the maintainer's own configuration.

## Testing Decisions

A good test here asserts which files an operator's generation contains after enabling the module in a given configuration — that the Skill lands at its expected place alongside whatever skills the operator already declares, that the hook merges into the operator's own hooks, and that nothing lands when Claude Code is off.
It does not assert module internals: not option values, not the store paths involved, not the shape of the generated file mechanism, because those are implementation detail of the wiring and would have to change in lockstep with it.

### The seam

There is one new seam, at the highest point available: a flake check that evaluates the actual module through home-manager's standalone configuration entry point and inspects the resulting home files derivation.
Evaluating the real module against real home-manager is the highest seam because it exercises exactly what a consumer's rebuild would, short of a full system, and it is the only seam that can reach the module at all — the existing fast tier and installed-binary tier operate on the built CLI and never evaluate Nix modules.

The check builds the home files derivation under several configurations and asserts on the tree it produces:

- An operator declaring their own skills as an attribute set: the module's Skill lands alongside the operator's, each at its own name.
- An operator declaring their own skills as a whole directory: the module's Skill lands alongside the operator's directory contents.
  This is the case that guards the recursive-install coupling; a regression in how the Claude Code module installs a path-form skills directory fails here as a build-time file collision.
- Claude Code disabled: no gitea-axi Skill entry is written.
  This guards the explicit sibling-enable gate, which is a correctness risk this design introduces rather than one it inherits.
- The hook merges into an operator's own SessionStart hook list rather than replacing it.

Building the home files derivation is sufficient and does not require the Claude Code binary or a running agent; it is the file-linkage layer of home-manager, which is what actually decides whether two declarations collide.

The byte-identical-generation property — that importing the module without enabling it yields the same generation as never importing it — was considered as a check and rejected as too brittle to assert: home-manager churns generation internals across versions, so the assertion would fail on version drift that is not the module's bug.
The narrower disabled-Claude-Code assertion above captures the part of that property which is actually the module's contract.

### Prior art

The flake already exposes a checks output and the repository already treats `nix flake check` as the health-check command; this adds a module check alongside the existing package check rather than introducing a new kind of verification surface.
The composition assertions mirror the shape of the design-time probes that established the approach: build the home files derivation under a given configuration, then read the skills subtree to confirm which entries are present.

## Out of Scope

Codex and OpenCode declarative integration.
The option surface is shaped to accept sibling toggles for them, but no such toggle is added now, with no second harness module to test against and the imperative `setup hooks` path still available for those harnesses on a declarative host.

A central aggregator toggle over all harnesses.
It is deferred until a second harness exists, and is additive when it arrives.

Any change to the imperative install path.
`setup` and `setup hooks` are unchanged and remain fully supported; the two paths are alternatives, not stages.

Removing or reworking the `package = null` fallback.
It is kept as-is; the upstream suggestion to revisit it was examined and found not to apply under the new gating.

## Further Notes

This spec refines the home-manager module portion of the [nix-flake-packaging spec](nix-flake-packaging.md) and reverses specific decisions of [ADR 0020](../adr/0020-home-manager-module-for-declarative-context.md); the reasoning is recorded in [ADR 0021](../adr/0021-per-harness-integration-and-home-file-skill.md).
The legs of ADR 0020 that survive — the hook declared through the Claude Code settings option, the module as a content-free wiring layer, the `hook specification` as the hook's single committed source of truth, and the absence of a declarative counterpart for Codex and OpenCode — are unchanged.

The upstream consumer's own analysis proposed defaulting the context toggles to `programs.claude-code.enable`.
That proposal is not adopted: it keys an option's default off sibling config, which the operator disliked and which does not generalise cleanly to multiple harnesses, and its stated diagnosis — that the whole config block sitting inside the module's own `enable` gate is what forces the awkward wiring — was incorrect.
The forcing was the assertion, and removing the assertion while reshaping the toggles addresses the friction the analysis identified without the config-derived default.

INSTALL.md's options table, its `package = null` paragraph, and its paragraph documenting the path-form skills limitation are updated to match: the limitation paragraph is removed, because the limitation no longer exists.
