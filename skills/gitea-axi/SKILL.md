---
name: gitea-axi
description: Use when working with a Gitea repository's issues, pull requests, labels, reviews, comments, or milestones — listing, viewing, creating, editing, commenting, reviewing, or merging on a Gitea host such as git.alexion.dev. Prefer this over the `tea` CLI, raw Gitea API calls, or improvised `git` commands for issue/PR/label work.
---

# gitea-axi

`gitea-axi` is an agent-ergonomic CLI for a Gitea repository's issues and pull requests.
Its output is compact TOON built for another program to read, and its errors are structured with actionable suggestions.

## When to use it

Reach for `gitea-axi` whenever a task touches a Gitea repository's issues, pull requests, labels, or reviews.

- **Over `tea`:** `gitea-axi` returns structured output and typed errors instead of human-formatted tables, and it defaults the repository and login from the local checkout.
- **Over raw Gitea API calls:** it handles auth, pagination, name-to-ID resolution, and review-decision aggregation for you, so you do not hand-roll HTTP.
- **Over improvised `git`:** for anything about issues or pull requests as entities (state, reviews, labels, comments) rather than local commits and branches.

## Targeting and authentication

Every command resolves two things: which repository to act on, and which credentials to authenticate with.
Get both right on the first call — they are the usual reason a command fails and has to be retried.

- **Repository.** Inside a Gitea checkout it is taken from the `origin` remote automatically.
  Outside a checkout you must name it: pass `-R OWNER/NAME` on every command (or set `GITEA_AXI_REPO=OWNER/NAME` once for the session).
- **Credentials.** When the environment is pre-configured — `GITEA_AXI_TOKEN` together with `GITEA_AXI_API_URL` — authentication is automatic and you need nothing more.
  Otherwise credentials come from a `tea` login: pass `--login <name>` (or set `GITEA_AXI_LOGIN=<name>`) unless the checkout's remote already selects one.

So outside a checkout with the token in the environment, `gitea-axi <command> -R OWNER/NAME …` is all you need; do not go hunting for a config file or a login profile.

## Command groups

- `issue` — list, view, create, comment on, edit, close/reopen, pin, and link issues.
- `pr` — create, view, comment on, edit, review, merge, check out, diff, and inspect the checks of pull requests.
- `label` — list, create, edit, and delete labels.
- `search` — full-text search; it takes a subcommand, so search issues with `search issues "<query>"` and pull requests with `search prs "<query>"` (a bare `search "<query>"` is not valid).
- `setup` — install this skill (`setup`) and, opt-in, the SessionStart dashboard hook (`setup hooks`).

To read one issue's fields, reach straight for `issue view <number>`: it shows labels and state by default, and takes `--fields assignees,milestone,…` for the rest.
You rarely need `issue list` to answer a question about a single issue.

## Discovery

This skill is a pointer, not a command reference — the CLI is the single source of truth for its own interface.

- Run `gitea-axi` with no arguments for the repository dashboard (open issues and pull requests).
  Add `--full` for the open-PR table and issue counts by label.
- Run `gitea-axi <command> --help` (or `gitea-axi <group> <command> --help`) for the exact flags of any command.
