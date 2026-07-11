# Authenticate diff HTTP GET via `tea login list --output json`

`pr get --diff` fetches diff content with a direct HTTP GET, bypassing the tea subprocess.
To get the auth token for that request, gitea-axi calls `tea login list --output json`, matches the login entry whose URL matches the current repo's hostname, and uses its token.

## Considered Options

**Read `~/.config/tea/config.yml` directly** — one fewer subprocess call, but couples gitea-axi to tea's internal storage format rather than its stable JSON output interface.

**Shell out to `tea login list --output json`** (chosen) — consistent with the rest of the architecture, which goes through tea's JSON interface for everything; decoupled from tea's file format internals.

## Amendment (2026-07-10): token comes from `tea login helper get`, not the list output

The original decision assumed `tea login list --output json` includes the token.
It does not: the list output carries only `name`, `url`, `ssh_host`, `user`, and `default` (verified against tea 0.14.2 and current tea main).

`tea login list --output json` remains the discovery interface (profile names, URLs, default flag, hostname matching).
The token for the selected login is fetched via `tea login helper get --login <name>`, tea's git-credential-protocol interface (`host=` on stdin, `password=` on stdout).
This stays on tea's stable machine interfaces rather than its YAML internals, and additionally gets OAuth token refresh for free — `helper get` refreshes near-expiry OAuth tokens in place, which reading `config.yml` directly could never do.
