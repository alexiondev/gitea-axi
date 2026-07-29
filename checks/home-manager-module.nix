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
# The configurations cover the remaining composition risks: the explicit
# sibling-enable gate that keeps the hook off a host without Claude Code, the
# hook merging into an operator's own SessionStart list rather than replacing it,
# and the Agent Skill staying out of global harness directories because project
# dev shells deliver it through the agent-agnostic skills helper.
{
  pkgs,
  home-manager,
  module,
  package,
}:
let
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

  # Claude Code disabled: the sibling-enable gate in the Claude Code module must
  # leave no settings file or Skill entry in the generation.
  claudeCodeOff = homeFiles {
    programs.claude-code.enable = false;
  };

  # Claude Code enabled: the module contributes only the SessionStart hook, not
  # a global Skill entry.
  claudeCodeOn = homeFiles {
    programs.claude-code.enable = true;
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
    # files tree under every configuration.
    inherit
      claudeCodeOff
      claudeCodeOn
      mergedHook
      ;
  }
  ''
    echo "Claude Code disabled: no hook settings or global Skill entry is written"
    test ! -e "$claudeCodeOff/.claude/settings.json"
    test ! -e "$claudeCodeOff/.claude/skills/gitea-axi"

    echo "Claude Code enabled: hook lands, but the Skill is not globally installed"
    grep -q '"gitea-axi"' "$claudeCodeOn/.claude/settings.json"
    test ! -e "$claudeCodeOn/.claude/skills/gitea-axi"

    echo "operator's own SessionStart hook: the module's hook merges in"
    # Match the commands as quoted JSON string values, not by their position or
    # the emitter's colon spacing: both must be present for a merge (rather than
    # a replacement) of the two SessionStart hooks.
    grep -q '"operator-own-session-hook"' "$mergedHook/.claude/settings.json"
    grep -q '"gitea-axi"' "$mergedHook/.claude/settings.json"

    touch "$out"
  ''
