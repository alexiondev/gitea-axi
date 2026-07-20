# Installing gitea-axi

gitea-axi is a CLI plus two pieces of *ambient context* it installs for your agent:

- an **Agent Skill**, which teaches the agent to reach for gitea-axi instead of `tea`, raw API calls, or improvised `git`;
- a **SessionStart hook**, which renders the repository dashboard at the start of every agent session.

Installing the binary and installing that context are separate steps, and the second one has two paths.
Which path you want depends on who owns `~/.claude`.

## Installing the binary

### npm

```sh
npm install -g gitea-axi
```

Nothing has been published to the registry yet, so this works only once the first release lands — see [PUBLISHING.md](PUBLISHING.md).
Until then, the Nix path below and a local `npm pack` are the working ones.

### Nix

The flake exposes the package as `packages.<system>.gitea-axi`, with `default` as an alias.

```sh
nix run git+https://git.alexion.dev/alexion/gitea-axi -- --help
```

To install it from a system configuration, add the flake as an input and put `gitea-axi.packages.${system}.default` in `environment.systemPackages`.
Point the flake's `nixpkgs` input at your own to deduplicate.

gitea-axi shells out to `git` and to `tea` — the latter for credential discovery, per [ADR 0001](.claude/adr/0001-diff-auth-via-tea-login-list.md).
The Nix package wraps the binary so both are reachable without your installing them, while still preferring your own where you have them ([ADR 0018](.claude/adr/0018-nix-wrapper-defers-to-operator-binaries.md)).

## Installing the ambient context

### The `setup` command, if you own your agent configuration

```sh
gitea-axi setup         # the Agent Skill
gitea-axi setup hooks   # and the SessionStart hook
```

Both are idempotent, and there is no postinstall script — installation is always explicit ([ADR 0009](.claude/adr/0009-setup-command-over-postinstall.md)).
`setup hooks` covers three agents: Claude Code, Codex, and OpenCode.

This is the right path when the files under `~/.claude` (and `~/.codex`, and `~/.config/opencode`) are yours to write.

### The home-manager module, if your configuration owns them

If your agent configuration is generated declaratively, `setup` cannot write to it — the targets are read-only, and gitea-axi reports that rather than failing obscurely.
Use the module instead ([ADR 0020](.claude/adr/0020-home-manager-module-for-declarative-context.md)).

```nix
{
  inputs.gitea-axi.url = "git+https://git.alexion.dev/alexion/gitea-axi";
  inputs.gitea-axi.inputs.nixpkgs.follows = "nixpkgs";
}
```

```nix
{
  imports = [ inputs.gitea-axi.homeModules.default ];

  programs.claude-code.enable = true;
  programs.gitea-axi.enable = true;
}
```

`programs.gitea-axi.enable` installs the CLI, always.
The Claude Code context — the Agent Skill and the SessionStart hook — follows the harness: it is declared under a single toggle, `programs.gitea-axi.enableClaudeCodeIntegration`, on by default, and lands only when `programs.claude-code.enable` is also on.
Enable gitea-axi on a host without Claude Code and you get the CLI and nothing else — no assertion, no toggles to turn off.
Importing the module without setting `enable` changes nothing at all.

The hook is declared through `programs.claude-code`'s own settings option, so a configuration that already sets its own `settings.hooks.SessionStart` gets gitea-axi's merged in alongside rather than colliding.
The Skill is written straight into Claude Code's skills directory, so it composes with your own skills whether you declare them as `programs.claude-code.skills.<name> = ...` or as a single path standing for a whole directory — there is no form you have to switch to.

#### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `programs.gitea-axi.enable` | `false` | Install the CLI. |
| `programs.gitea-axi.package` | your `pkgs`' build of the package | The package to install, or `null` to declare the context without the binary. |
| `programs.gitea-axi.enableClaudeCodeIntegration` | `true` | Declare the Agent Skill and SessionStart hook when Claude Code is enabled. |

`package = null` declares the context without installing the binary — for instance when you install gitea-axi system-wide through `environment.systemPackages`.
The hook records the bare name `gitea-axi` and lets `PATH` resolve it ([ADR 0019](.claude/adr/0019-hook-records-search-path-name.md)), so a binary installed anywhere on `PATH` satisfies it, and the Skill is still taken from the default build.

Turn `enableClaudeCodeIntegration` off to keep the CLI declarative while writing the Skill and hook yourself with `setup`.

#### What the module does not cover

Only the Claude Code integration is declarative.
The Codex and OpenCode files that `setup hooks` also writes have no home-manager module owning them, so gitea-axi does not write them declaratively either.
On a declarative system those targets are unmanaged and therefore writable, so `gitea-axi setup hooks` still installs them.

## Verifying an install

```sh
gitea-axi --help
gitea-axi            # the dashboard, from inside a Gitea repository
```

A SessionStart hook takes effect on the next agent session, not the current one.
