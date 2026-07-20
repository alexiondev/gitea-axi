# A home-manager module installing gitea-axi and, when a harness is present,
# its ambient context — the bundled Agent Skill and the SessionStart hook
# (ADR 0020, reshaped by ADR 0021).
#
# `programs.gitea-axi.enable` installs the CLI, always. The Claude Code context
# follows the harness: it is declared under one per-harness toggle and lands
# only when `programs.claude-code.enable` is also on. gitea-axi is a working CLI
# without a harness, so enabling it on a host with no Claude Code installs the
# binary and nothing else, with no assertion.
#
# The module is a wiring layer and nothing more. Both artefacts come from the
# package's published attributes, so what a declarative configuration installs
# and what `gitea-axi setup` writes imperatively are the same two artefacts, and
# neither is restated here.
#
# Importing this module changes nothing until `programs.gitea-axi.enable` is set.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.gitea-axi;

  # The package the declarations are read out of. `package = null` opts out of
  # putting the binary on PATH, not out of the configuration — an operator who
  # installs gitea-axi system-wide still wants the Skill — so the declarations
  # fall back to the default build, which in that arrangement is already in the
  # closure anyway.
  sourcePackage = if cfg.package != null then cfg.package else defaultPackage;

  defaultPackage = pkgs.callPackage ./package.nix { };

  claudeCode = config.programs.claude-code;
in
{
  options.programs.gitea-axi = {
    enable = lib.mkEnableOption "gitea-axi, an agent-ergonomic CLI for Gitea issues and pull requests";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = ''
        The gitea-axi package to install, or `null` to declare the ambient
        context without installing the binary — for an operator who supplies it
        another way, such as `environment.systemPackages`.

        The SessionStart hook records a name resolved on `PATH`, so a binary
        installed elsewhere satisfies it. With `null` the Agent Skill is still
        taken from the default build.
      '';
    };

    enableClaudeCodeIntegration = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to declare gitea-axi's Claude Code context — the bundled Agent
        Skill and the SessionStart hook — alongside the CLI.

        Both artefacts land only when `programs.claude-code.enable` is also on;
        with it off they are silently absent, matching how home-manager's own
        `enableBashIntegration`-style toggles behave against a disabled sibling.

        Turn this off to install gitea-axi declaratively while writing the
        Claude Code context by hand or with `gitea-axi setup`. The toggle
        generalises: a future harness reads as `enableCodexIntegration`.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      (lib.mkIf (cfg.package != null) { home.packages = [ cfg.package ]; })

      # The two Claude Code artefacts move together under one per-harness
      # toggle. They are gated by different mechanisms internally — the Skill by
      # an explicit `claude-code.enable` condition, the hook by the Claude Code
      # module's own gate — because of how each is declared, below.
      (lib.mkIf cfg.enableClaudeCodeIntegration (
        lib.mkMerge [
          # The hook is declared through the Claude Code module's own settings
          # option. That composes it with an operator's own SessionStart hooks
          # instead of colliding, and the module drops the declaration for free
          # when it is disabled — so no explicit `claude-code.enable` gate here.
          { programs.claude-code.settings.hooks.SessionStart = [ sourcePackage.sessionStartHook ]; }

          # The Skill is written as an ordinary file into Claude Code's skills
          # directory, rather than contributed to `programs.claude-code.skills`.
          # That composes with both forms of the operator's own skills option —
          # an attribute set and a single path for a whole directory — because
          # it never touches that option's type, so the path-form collision
          # disappears at its root instead of being escaped by a toggle.
          #
          # Writing through home.file does not inherit the Claude Code module's
          # `enable`-gate the way declaring through its options does, so the
          # Skill is gated on `claude-code.enable` explicitly. The gate is also
          # what keeps package realisation lazy: home.file reads the Skill's
          # source directory while evaluating, so an ungated write would realise
          # the package on every host — even one with no Claude Code that
          # installs nothing from it.
          #
          # `configDir` is read from the Claude Code module rather than
          # hardcoded, so the Skill lands beside that module's own skills
          # wherever the operator points it.
          (lib.mkIf claudeCode.enable {
            home.file."${claudeCode.configDir}/skills/gitea-axi" = {
              source = sourcePackage.skill;
              recursive = true;
            };
          })
        ]
      ))
    ]
  );
}
