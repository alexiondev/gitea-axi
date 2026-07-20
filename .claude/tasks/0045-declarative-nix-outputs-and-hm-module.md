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

- [x] The bundled Agent Skill is installed to a stable location in the package output that is not an internal implementation path.
- [x] The package exposes the Skill and the hook specification as attributes consumable from a Nix expression without building or running anything.
- [x] The hook specification is declared in a single committed file, read by both the Nix expression and the test suite.
- [x] A test drives the imperative hook install and asserts that what it writes matches the declared specification, failing if either side drifts.
- [x] The flake exposes a home-manager module that declares the Skill and the hook.
- [x] Importing the module without enabling it changes nothing about the resulting configuration.
- [x] The module installs the package by default, and accepts a null package as the documented way to declare the configuration without installing the binary.
- [x] The Skill and the hook each have their own toggle, both defaulting to on.
- [x] The module composes with an existing configuration that already declares its own SessionStart hooks and skills, rather than conflicting with it.
- [x] The spec's Out of Scope entry excluding a home-manager module is revised, and the decision to reverse it is recorded as an ADR.
- [x] The user-facing documentation describes both installation paths and when each applies.

## Implementation Notes

The decision is recorded as [ADR 0020](../adr/0020-home-manager-module-for-declarative-context.md).
The spec's Out of Scope entry is deleted and its "Flake surface" section rewritten to record the reversal rather than to pretend the deferral never happened.

### The hook specification is the settings entry, not its parts

`session-start-hook.json` holds the SessionStart entry verbatim as it belongs in a Claude Code `settings.json` — matcher, and the hook array inside it — rather than the fields the entry is assembled from.
Declaring the fields would have left the *grouping* restated in both the Nix expression and the test, which is exactly the kind of second source of truth the file exists to prevent.
As written, the Nix expression is `[ sourcePackage.sessionStartHook ]` and the test is a deep-equality against the same value, so neither restates anything.

The file's contents were derived by observation — running the installed binary against a temporary home and reading what the agent SDK wrote — and the new test was confirmed to fail when the declaration is perturbed, rather than being assumed to bite.

### The module declares through `programs.claude-code`, not through `home.file`

Writing `~/.claude/settings.json` directly would collide with home-manager's own Claude Code module, so the module sets that module's options and lets home-manager's merge semantics compose.
Verified against real home-manager before landing, on five configurations: importing without enabling produces a **byte-identical** generation to never importing at all; enabling alongside a configuration that already declares its own SessionStart hook and its own skill yields both of each; `package = null` installs no binary but still declares the Skill; the skill-only toggle declares no hook; and omitting `programs.claude-code.enable` fails the assertion with the intended message.

### `package = null` still sources the Skill from the default build

The task called null "the documented opt-out for an operator who supplies the binary another way", which settles where the *binary* comes from but not where the Skill's bytes do.
They come from the default build, which for the intended case — a system-wide install of this same package — is already in the closure.
The sharp edge is an operator whose system-wide copy is a different build: their Skill would come from a package they are not running.
That is documented on the option itself rather than designed away, since the alternative is refusing to declare a Skill at all in the one arrangement the null value exists to serve.

### Two limitations documented rather than fixed

Home-manager inspects the Skill path during evaluation, so a rebuild realises the package at evaluation time even under `package = null`.
This is inherent to sourcing the Skill from the package and is a rebuild-latency cost, not a correctness one; the alternative would ignore `package` overrides entirely.

`programs.claude-code.skills` also accepts a bare path standing for a whole skills directory, and a configuration using that form cannot have an entry merged into it.
Both are recorded in INSTALL.md and in the ADR's Consequences.

### Follow-up worth flagging

The repository has no `README.md`, so `INSTALL.md` — which follows the existing convention of topic-scoped root documents alongside `PUBLISHING.md` — is discoverable only by browsing the repository, and is not in the npm `files` allowlist so it does not ship in the tarball.
Neither was changed here: adding a README is its own piece of work, and installation instructions inside an already-installed tarball are of little use.
