# Authenticate diff HTTP GET via `tea login list --output json`

`pr get --diff` fetches diff content with a direct HTTP GET, bypassing the tea subprocess.
To get the auth token for that request, gitea-axi calls `tea login list --output json`, matches the login entry whose URL matches the current repo's hostname, and uses its token.

## Considered Options

**Read `~/.config/tea/config.yml` directly** — one fewer subprocess call, but couples gitea-axi to tea's internal storage format rather than its stable JSON output interface.

**Shell out to `tea login list --output json`** (chosen) — consistent with the rest of the architecture, which goes through tea's JSON interface for everything; decoupled from tea's file format internals.
