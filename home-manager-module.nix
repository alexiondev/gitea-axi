# A home-manager module installing gitea-axi and, when Claude Code is present,
# its SessionStart hook.
#
# `programs.gitea-axi.enable` installs the CLI, always.
# The Agent Skill is exposed as a package output for agent-agnostic delivery by
# a project's dev shell or an operator's shared skill delivery module.
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
  # putting the binary on PATH, not out of the hook declaration — an operator who
  # installs gitea-axi system-wide still wants the hook — so the declarations
  # fall back to the default build, which in that arrangement is already in the
  # closure anyway.
  sourcePackage = if cfg.package != null then cfg.package else defaultPackage;

  defaultPackage = pkgs.callPackage ./package.nix { };
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
        Claude Code hook without installing the binary — for an operator who
        supplies it another way, such as `environment.systemPackages`.

        The SessionStart hook records a name resolved on `PATH`, so a binary
        installed elsewhere satisfies it.
      '';
    };

    enableClaudeCodeIntegration = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to declare gitea-axi's Claude Code SessionStart hook alongside
        the CLI.

        The hook lands only when `programs.claude-code.enable` is also on;
        with it off it is silently absent, matching how home-manager's own
        `enableBashIntegration`-style toggles behave against a disabled sibling.

        Turn this off to install gitea-axi declaratively while writing the
        Claude Code hook by hand or with `gitea-axi setup`.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      (lib.mkIf (cfg.package != null) { home.packages = [ cfg.package ]; })

      (lib.mkIf cfg.enableClaudeCodeIntegration {
        # The hook is declared through the Claude Code module's own settings
        # option. That composes it with an operator's own SessionStart hooks
        # instead of colliding, and the module drops the declaration for free
        # when it is disabled.
        programs.claude-code.settings.hooks.SessionStart = [ sourcePackage.sessionStartHook ];
      })
    ]
  );
}
