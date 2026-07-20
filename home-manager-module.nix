# A home-manager module declaring gitea-axi's ambient context — the bundled
# Agent Skill and the SessionStart hook — for an operator whose agent
# configuration is generated rather than owned (ADR 0020).
#
# It is a wiring layer and nothing more. Both pieces come from the package's
# published attributes, so what a declarative configuration installs and what
# `gitea-axi setup` writes imperatively are the same two artefacts, and neither
# is restated here.
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

  # Both integrations write into files a sibling module owns, so nothing lands
  # unless that module is the one writing them.
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
        The gitea-axi package to install, or `null` to declare the
        configuration without installing the binary — for an operator who
        supplies it another way, such as `environment.systemPackages`.

        The SessionStart hook records a name resolved on `PATH`, so a binary
        installed elsewhere satisfies it. With `null` the Agent Skill is still
        taken from the default build.
      '';
    };

    skill.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to install gitea-axi's bundled Agent Skill, which teaches the
        agent to reach for gitea-axi over `tea` or raw API calls.

        Turn this off to keep writing the Skill with `gitea-axi setup` while
        managing the rest declaratively.
      '';
    };

    sessionStartHook.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to register the SessionStart hook that renders the gitea-axi
        dashboard at the start of an agent session.

        Turn this off to keep writing the hook with `gitea-axi setup hooks`
        while managing the rest declaratively.
      '';
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      (lib.mkIf (cfg.package != null) { home.packages = [ cfg.package ]; })

      # Declared through the Claude Code module's own options rather than by
      # writing its files, so an operator who already declares Skills and
      # SessionStart hooks gets ours merged into theirs instead of a collision.
      (lib.mkIf cfg.skill.enable {
        programs.claude-code.skills.gitea-axi = sourcePackage.skill;
      })

      (lib.mkIf cfg.sessionStartHook.enable {
        programs.claude-code.settings.hooks.SessionStart = [ sourcePackage.sessionStartHook ];
      })

      {
        # Without this the options above are set and silently dropped, leaving
        # an operator with a configuration that says the Skill is installed and
        # a session that never sees it.
        assertions = [
          {
            assertion = (cfg.skill.enable || cfg.sessionStartHook.enable) -> claudeCode.enable;
            message = ''
              programs.gitea-axi declares a Claude Code Agent Skill and session
              hook, which programs.claude-code writes. Set
              programs.claude-code.enable = true, or turn off
              programs.gitea-axi.skill.enable and
              programs.gitea-axi.sessionStartHook.enable.
            '';
          }
        ];
      }
    ]
  );
}
