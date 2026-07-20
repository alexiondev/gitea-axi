# Ship a home-manager module for gitea-axi's ambient context

The flake exposes `homeModules.gitea-axi`, a home-manager module that declares the bundled Agent Skill and the SessionStart hook, installing the package by default.
Importing it does nothing; `programs.gitea-axi.enable` switches it on, and the Skill and the hook each carry their own toggle, both defaulting on.

The package publishes what the module consumes: the Skill at a stable address in the output, and the SessionStart hook entry read from `session-start-hook.json`, a committed file the fast tier reads too.

`setup` and `setup hooks` are unchanged and remain fully supported.
The two paths are alternatives, not stages.

## Context

The [nix-flake-packaging spec](../spec/nix-flake-packaging.md) listed a home-manager module under Out of Scope, deferred rather than rejected, on the grounds that managing the Agent Skill declaratively "would reintroduce exactly the automatism that ADR 0009 rejected when it chose an explicit `setup` command over a postinstall script", and that the trade-off deserved its own decision made with usage evidence.

The evidence arrived, and it does not support the deferral's reasoning.

`setup` and `setup hooks` are write-only against files the operator is assumed to own.
An operator whose agent configuration is generated declaratively cannot use either: the targets are read-only, which task 0044 made fail cleanly rather than obscurely, but failing cleanly is not the same as working.
What that operator does instead is hand-copy the Skill into their own configuration, where it silently drifts from the package that ships it — the exact failure the bundled Skill exists to prevent.

The deferral's stated concern also does not survive contact with what a module is.
ADR 0009 rejected a *postinstall script*: something that runs without being asked, as a side effect of installing a package.
A module the operator imports and then explicitly enables is the opposite — it is the declarative spelling of running `setup`, not a substitute for the operator's consent.
The automatism ADR 0009 guards against is absence of intent, and an `enable` option is intent.

## Considered Options

**Keep deferring** (rejected) — The deferral was conditional on evidence, and the evidence is in.
Leaving it deferred means the one operator the whole spec was written for still installs the Skill by hand.

**Teach `setup` to emit a Nix expression** (rejected) — A code generator producing configuration the operator then commits.
It inverts the dependency: the generated expression is a snapshot that goes stale the moment the package changes, which is the drift problem restated rather than solved.

**Write `~/.claude/settings.json` and the Skill from `home.file` directly** (rejected) — The straightforward spelling, and it collides head-on with `programs.claude-code`, which owns `settings.json`.
An operator using both modules would get a home-manager conflict on that file, and the composition the module exists to provide would be exactly what it broke.

**Declare through the Claude Code module's own options** (chosen) — `programs.claude-code.skills.gitea-axi` and `programs.claude-code.settings.hooks.SessionStart`.
Home-manager's own merge semantics then do the composing: attribute sets merge, lists concatenate, and an operator who already declares their own Skills and SessionStart hooks gets ours alongside theirs rather than instead of them.
The cost is a dependency on that sibling module being enabled, which is asserted rather than assumed.

## Consequences

- The module is a wiring layer with no content of its own.
  Everything it declares comes from the package's `passthru`, so the declarative and imperative paths install the same two artefacts by construction.
- `session-start-hook.json` is the hook's single declaration.
  The Nix expression reads it and the fast tier reads it, and that tier drives `setup hooks` against a temporary home and asserts the written entry equals the declared one.
  A divergence — including the agent SDK changing the envelope it writes — fails a test instead of shipping.
  Declaring the entry in the Nix expression instead would have created a second source of truth with nothing checking it against the first, and a test restating the same values a third time would have verified nothing.
- The Skill is installed to `share/gitea-axi/skills/gitea-axi` in the output and published as `passthru.skill`.
  Its other copy, inside the installed node modules tree where `setup` resolves it relative to its own module, is an implementation detail of runtime resolution that moves with the packaging method; no consumer should address it.
- `package = null` means the binary is not added to `home.packages`, for an operator installing it through `environment.systemPackages` instead.
  It does not mean the configuration is empty: the Skill still comes from the default build, which in that arrangement is already in the closure.
  The hook is unaffected either way, since it records a name resolved on `PATH` (ADR 0019) rather than a store path.
- Home-manager inspects the Skill path while evaluating, so a rebuild realises the package during evaluation rather than at build time — including under `package = null`, where nothing is being installed.
  That is inherent to sourcing the Skill's bytes from the package: any store path handed to `programs.claude-code.skills` has the same effect.
  It is a cost in rebuild latency, not in correctness, and pointing the module at the repository's own `skills/` directory to avoid it was rejected — that would ignore `package` entirely, so an operator running an override would get a Skill from a build they are not running.
- `programs.claude-code.skills` also accepts a single path standing for a whole skills directory, and a configuration using that form cannot have an entry merged into it.
  Such a configuration gets a type-merge error rather than composition.
  This is documented in [INSTALL.md](../../INSTALL.md) rather than worked around, since the workaround would mean writing the Skill file directly and reintroducing the collision this decision avoids.
- The module defaults `package` to `pkgs.callPackage ./package.nix { }` — the importing configuration's own package set, not this flake's nixpkgs.
  That is how a consumer deduplicates, and it is why the derivation is a callable expression rather than a flake-bound one.
- Enabling the Skill or the hook without `programs.claude-code.enable` is an assertion failure rather than a silent no-op.
  Those options are written by a module that is gated on its own `enable`, so without the assertion an operator would get a configuration that says the Skill is installed and a session that never sees it.
- `nix flake check` does not evaluate the module, because doing so would mean taking home-manager as a flake input purely to test against.
  This matches the spec's existing position that the flake's consumption from a system configuration is verified by the maintainer's rebuild rather than by an automated test: building the package proves the derivation, and whether the configuration wires it in is outside this repository.
  The module was verified before landing against real home-manager, including that importing it without enabling it yields a byte-identical generation to never importing it at all.
- The two Codex integrations `setup hooks` writes — `~/.codex/hooks.json` and `~/.codex/config.toml` — and the OpenCode plugin file have no declarative counterpart here.
  Home-manager has no module owning those files, so declaring them would mean writing them directly and re-creating the collision problem this decision avoids for Claude Code.
  An operator wanting those on a declarative system uses `setup hooks`, whose targets are unmanaged there and therefore writable.
