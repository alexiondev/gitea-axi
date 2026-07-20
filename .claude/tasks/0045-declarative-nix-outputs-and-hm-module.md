---
spec: nix-flake-packaging
blocked-by: 0043-hook-records-bare-binary-name
---

## What to build

Let a Nix configuration declare gitea-axi's ambient context, instead of running a command that writes it.

`setup` and `setup hooks` are write-only.
They install the Agent Skill and the SessionStart hook by writing into the user's agent configuration directory, which works only when the user owns those files imperatively.
An operator whose agent configuration is generated declaratively cannot use either: the targets are read-only, and the operator is left hand-copying the Skill into their own configuration, where it silently drifts from the package that ships it.

The spec currently lists a home-manager module under Out of Scope, deferring it until there was usage evidence that the trade-off was worth making.
That evidence now exists, and the deferral's stated reasoning does not survive it: the concern was the automatism that ADR 0009 rejected when it chose an explicit `setup` command over a postinstall script, and a module the operator explicitly imports and enables is the opposite of an implicit install.
Revising that Out of Scope entry, and recording the decision as an ADR, is part of this task.

Two layers, the second built on the first.

The package gains a stable, documented location for the bundled Agent Skill, and exposes both the Skill and the hook's specification as attributes a Nix expression can consume.
Today the Skill's only address is a path inside the installed node modules tree, which is an implementation detail no consumer should depend on.

On top of that, the flake exposes a home-manager module: a thin wiring layer that declares the Skill and the hook from those attributes.
It follows the conventions the home-manager module tree overwhelmingly uses — an enable option so that importing the module does nothing until it is switched on, an overridable package option, and installation of that package by default with a null value as the documented opt-out for an operator who supplies the binary another way.
Each managed piece has its own toggle, defaulting on, so an operator can take the Skill declaratively while continuing to write the hook by hand.

The hook's specification is declared once, in a committed file that both the Nix expression and the test suite read.
Declaring it in the Nix expression alone would create a second source of truth alongside the behaviour of the imperative install path, with nothing to keep them agreed; a test that hardcoded the same values a third time would verify nothing.
The test drives the imperative install against a temporary home directory and asserts that what it writes matches what the file declares, so a divergence — including one introduced by the SDK changing the envelope it writes — fails a test rather than passing silently into a release.

The two installation paths remain independent and both supported: the command for operators who own their configuration, the module for operators whose configuration owns them.

## Acceptance criteria

- [ ] The bundled Agent Skill is installed to a stable location in the package output that is not an internal implementation path.
- [ ] The package exposes the Skill and the hook specification as attributes consumable from a Nix expression without building or running anything.
- [ ] The hook specification is declared in a single committed file, read by both the Nix expression and the test suite.
- [ ] A test drives the imperative hook install and asserts that what it writes matches the declared specification, failing if either side drifts.
- [ ] The flake exposes a home-manager module that declares the Skill and the hook.
- [ ] Importing the module without enabling it changes nothing about the resulting configuration.
- [ ] The module installs the package by default, and accepts a null package as the documented way to declare the configuration without installing the binary.
- [ ] The Skill and the hook each have their own toggle, both defaulting to on.
- [ ] The module composes with an existing configuration that already declares its own SessionStart hooks and skills, rather than conflicting with it.
- [ ] The spec's Out of Scope entry excluding a home-manager module is revised, and the decision to reverse it is recorded as an ADR.
- [ ] The user-facing documentation describes both installation paths and when each applies.
