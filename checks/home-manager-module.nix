# The first automated proof of the home-manager module's composition (ADR 0021).
#
# It evaluates the *real* module through home-manager's standalone configuration
# entry point and builds the resulting home files derivation — the file-linkage
# layer that actually decides whether two declarations collide — under several
# operator configurations, then asserts on the tree each one produces. It never
# reads module internals: not option values, not store paths, not the shape of
# the file mechanism, only which files a generation contains. Building the home
# files derivation needs neither the Claude Code binary nor a running agent.
#
# The configurations cover the composition risks the reshape introduced: the
# Skill coexisting with an operator's own skills in both the attribute-set and
# whole-directory forms, the explicit sibling-enable gate that keeps the Skill
# off a host without Claude Code, and the hook merging into an operator's own
# SessionStart list rather than replacing it.
{
  pkgs,
  home-manager,
  module,
  package,
}:
let
  inherit (pkgs) lib;

  # A skill the operator declares as their own, as one attribute-set entry. Its
  # SKILL.md is what the attribute-set assertion looks for beside the module's.
  operatorAttrSkill = pkgs.runCommandLocal "operator-attr-skill" { } ''
    mkdir -p "$out"
    printf '%s\n' "the operator's own attribute-set skill" > "$out/SKILL.md"
  '';

  # A whole directory of skills, one folder per skill, for the path form of the
  # operator's own `programs.claude-code.skills`. The Claude Code module installs
  # this recursively; the module's own nested Skill entry has to drop in beside
  # its contents rather than collide with a single link over the directory.
  operatorSkillsDir = pkgs.runCommandLocal "operator-skills-dir" { } ''
    mkdir -p "$out/operator-dir-skill"
    printf '%s\n' "the operator's own whole-directory skill" \
      > "$out/operator-dir-skill/SKILL.md"
  '';

  # A distinctive command so the merged-hook assertion can tell the operator's
  # own SessionStart hook apart from gitea-axi's in the generated settings.json.
  operatorHook = {
    matcher = "";
    hooks = [
      {
        type = "command";
        command = "operator-own-session-hook";
      }
    ];
  };

  # Evaluate the real module through home-manager's standalone entry point and
  # return the home files derivation — the tree home-manager would link into
  # $HOME. `programs.gitea-axi.enable` is on in every configuration; the package
  # is the flake's own build, so the check reuses the store path the package
  # check already produces rather than building a second time.
  homeFiles =
    operatorConfig:
    (home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        module
        {
          home.username = "operator";
          home.homeDirectory = "/home/operator";
          home.stateVersion = "24.11";

          programs.gitea-axi.enable = true;
          programs.gitea-axi.package = package;
        }
        operatorConfig
      ];
    }).config.home-files;

  # An operator on Claude Code who declares their own skill as an attribute-set
  # entry: the module's Skill and theirs must both land, each at its own name.
  attrSetSkills = homeFiles {
    programs.claude-code.enable = true;
    # A store path (not a bare derivation): the skills value type takes a path,
    # and a derivation would be read as the attribute-set branch of the option.
    programs.claude-code.skills.operator-attr-skill = "${operatorAttrSkill}";
  };

  # An operator who declares their own skills as a whole directory (path form):
  # the module's Skill lands beside the directory's contents. A regression to a
  # non-recursive path-form install would fail this build as a file collision.
  wholeDirSkills = homeFiles {
    programs.claude-code.enable = true;
    programs.claude-code.skills = "${operatorSkillsDir}";
  };

  # Claude Code disabled: the explicit sibling-enable gate must leave no
  # gitea-axi Skill entry in the generation.
  claudeCodeOff = homeFiles {
    programs.claude-code.enable = false;
  };

  # An operator with their own SessionStart hook: the module's hook must merge
  # into that list rather than replace it.
  mergedHook = homeFiles {
    programs.claude-code.enable = true;
    programs.claude-code.settings.hooks.SessionStart = [ operatorHook ];
  };
in
pkgs.runCommandLocal "gitea-axi-home-manager-module-check"
  {
    # Forcing each derivation as a build input is what actually builds the home
    # files tree under every configuration; the whole-directory build would fail
    # here, before any assertion runs, on a non-recursive-install regression.
    inherit
      attrSetSkills
      wholeDirSkills
      claudeCodeOff
      mergedHook
      ;
  }
  ''
    echo "attribute-set skills: module's Skill and operator's both land"
    test -f "$attrSetSkills/.claude/skills/gitea-axi/SKILL.md"
    test -f "$attrSetSkills/.claude/skills/operator-attr-skill/SKILL.md"

    echo "whole-directory skills: module's Skill lands beside the directory"
    test -f "$wholeDirSkills/.claude/skills/gitea-axi/SKILL.md"
    test -f "$wholeDirSkills/.claude/skills/operator-dir-skill/SKILL.md"

    echo "Claude Code disabled: no gitea-axi Skill entry is written"
    test ! -e "$claudeCodeOff/.claude/skills/gitea-axi"

    echo "operator's own SessionStart hook: the module's hook merges in"
    # Match the commands as quoted JSON string values, not by their position or
    # the emitter's colon spacing: both must be present for a merge (rather than
    # a replacement) of the two SessionStart hooks.
    grep -q '"operator-own-session-hook"' "$mergedHook/.claude/settings.json"
    grep -q '"gitea-axi"' "$mergedHook/.claude/settings.json"

    touch "$out"
  ''
