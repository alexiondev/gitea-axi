# Declare the Agent Skill through home.file and gate integration per harness

The home-manager module installs the gitea-axi binary whenever `programs.gitea-axi.enable` is set, and declares the Claude Code Agent Skill and SessionStart hook under a single per-harness toggle, `programs.gitea-axi.enableClaudeCodeIntegration`, defaulting on.
Those two artefacts land only when `programs.claude-code.enable` is also on, and are silently absent otherwise — there is no assertion.

The Skill is written through home-manager's own file mechanism, into Claude Code's skills directory under the `gitea-axi` name, rather than by contributing to `programs.claude-code.skills`.
The hook is still declared through `programs.claude-code`'s settings option, unchanged.

This supersedes three decisions of [ADR 0020](0020-home-manager-module-for-declarative-context.md): the per-artefact toggles and their assertion, the Skill's declaration through the Claude Code module's skills option, and the position that the flake takes no home-manager input.
The rest of ADR 0020 stands.

## Context

ADR 0020 gave the Skill and the hook one toggle each, both defaulting on, and made enabling either without `programs.claude-code.enable` an assertion failure.
The assertion fires on the common case.
An operator who wants gitea-axi as a standalone CLI on a host without Claude Code has not made a mistake, but the module meets them with a build failure telling them to turn off two toggles.
Reaching the standalone shape means setting the module's `enable` to whatever `programs.claude-code.enable` is, and then setting `package = null` so the module does not install a binary the operator installs itself — leaving an `enable` that does not mean "enabled" and a `null` package that does not mean "no package".

Underneath that is a composition failure ADR 0020 documented as a limitation rather than fixed.
`programs.claude-code.skills` accepts either an attribute set of skills or a single path standing for a whole skills directory.
Contributing the module's Skill as an attribute entry cannot merge with an operator who set the option to a path: the two are different branches of the option's type, and the evaluation fails.
ADR 0020's remedy was to disable the Skill and place it by hand, which reintroduces the hand-copying-that-drifts the bundled Skill exists to prevent.

The two problems share a root.
The Skill was routed through a sibling module's typed option, so it inherited that option's merge behaviour — including the branch that cannot merge — and the whole integration was gated by an assertion because the declaration's only enforcement point was that assertion.

## Considered Options

**Default the toggles to `programs.claude-code.enable`** (rejected) — The upstream consumer's own suggestion.
It keys an option's default off a sibling module's config, which is the config-derived default the operator found objectionable, and it does not generalise to multiple harnesses without each toggle reaching into a different sibling.
Its stated diagnosis was also wrong: the friction is the assertion firing on the common case, not the module's `config` block sitting inside its own `enable` gate, which is unremarkable.

**Keep the per-artefact toggles, drop the assertion to a warning** (rejected) — Leaves the Skill routed through `programs.claude-code.skills`, so the path-form collision remains, and keeps a per-artefact surface that does not generalise to harnesses whose artefacts differ from Claude Code's.

**Write the Skill and the settings file directly, bypassing both sibling options** (rejected for the hook, adopted for the Skill) — ADR 0020 rejected this as one option, on the grounds that it collides with `programs.claude-code` owning the settings file.
That reasoning is sound for the hook and false for the Skill.
The settings file is a single file the Claude Code module owns wholesale, so writing it directly collides; Skill files are per-path, so writing the Skill's own path collides with nothing the operator has not themselves put there.
ADR 0020 bundled the Skill into a rejection only its sibling earned.

**Declare the Skill through home.file and gate integration per harness** (chosen) — The Skill is written as an ordinary file declaration at its own path, which never touches the skills option's type and so composes with both the attribute-set and whole-directory forms.
The per-artefact toggles collapse into one per-harness toggle whose name follows home-manager's `enableBashIntegration` convention and leaves room for sibling harnesses.
The assertion is removed: writing into a disabled sibling's option is a benign no-op by home-manager convention, and the Skill's own gate makes its absence equally silent.

## Consequences

- The Skill composes with an operator's own skills whichever form they use.
  Under the attribute-set form the Claude Code module lowers each skill to its own file declaration, so the module's Skill is one more entry at a distinct name.
  Under the whole-directory path form that module installs the directory recursively — individually-linked files under a real directory — so the module's nested Skill entry drops in as a sibling.
  This was verified by building the home files derivation under both forms and confirming all entries coexist.

- The composition under the path form couples to the Claude Code module installing a path-form skills directory recursively.
  A change there to a non-recursive install would claim the whole skills directory as one link and collide with the module's nested Skill as a build-time file conflict.
  The failure would be loud and immediate rather than silent, and the flake check below is what would catch it.

- The Skill no longer inherits the Claude Code module's `enable`-gate, because it is declared by this module's own file mechanism rather than through that module's options.
  The module therefore gates the Skill write on `programs.claude-code.enable` explicitly, alongside `programs.gitea-axi.enable` and the integration toggle.
  This keeps the intended semantics — no Skill on a host without Claude Code — and keeps the package realisation lazy, since the file mechanism reads the Skill's source path while evaluating and an ungated declaration would realise the package on every host, even one installing nothing.

- The hook keeps its gate for free.
  It is declared through the Claude Code module's settings option, which that module drops and never forces when it is disabled.
  The two artefacts are thus gated by different mechanisms — the Skill by an explicit sibling-enable condition, the hook by the sibling module's own gate — and the module comments the asymmetry so it is not mistaken for an oversight.

- Granularity is per harness, not per artefact.
  One toggle installs both Claude Code artefacts, and future harnesses read as `enableCodexIntegration` and `enableOpenCodeIntegration` siblings.
  The per-artefact escape hatch ADR 0020 offered — disable the Skill, keep the hook — is no longer needed, because the case it existed for was the path-form collision, and that collision is now fixed rather than escaped.

- The integration toggle defaults to a literal `true`, not to `programs.claude-code.enable`.
  The declared value stays constant, and the honest gating lives at the point of declaration rather than in a config-derived default.

- `nix flake check` now evaluates the module.
  A home-manager input is added, with its nixpkgs following the flake's, so the module is checked against the same pairing a consumer following this flake would get.
  This reverses ADR 0020's position that the flake takes no home-manager input and the module is verified only by a maintainer rebuild.
  The reversal buys the first automated proof of the module's composition — the path-form coexistence, the attribute-set coexistence, the disabled-Claude-Code gating, and the hook merging into an operator's own hooks — where a rebuild proved it only after the fact and only on the maintainer's own configuration.

- `package = null` is unchanged.
  It still declares the Skill and hook from the default build without adding the binary to the operator's packages, and the fallback that reads the default build's Skill is kept.
  Under the new gating that fallback is reached only when Claude Code is enabled, so the upstream suggestion to revisit it as a wasteful second evaluation does not apply.

- ADR 0020's surviving decisions are unaffected: the hook declared through the Claude Code settings option, the module as a content-free wiring layer sourcing both artefacts from the package, the `hook specification` as the hook's single committed source of truth checked by both paths, and the absence of a declarative counterpart for Codex and OpenCode.
