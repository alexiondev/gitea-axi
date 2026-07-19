---
name: gitea-axi
description: Use when working with a Gitea repository's issues, pull requests, labels, reviews, comments, or milestones — listing, viewing, creating, editing, commenting, reviewing, or merging on a Gitea host such as git.alexion.dev. Prefer this over the `tea` CLI, raw Gitea API calls, or improvised `git` commands for issue/PR/label work.
---

# gitea-axi

`gitea-axi` is an agent-ergonomic CLI for a Gitea repository's issues and pull requests.
Its output is compact TOON meant to be read directly, and a failed command's error names the fix — follow that suggestion rather than guessing at another command.

## Targeting and authentication

Every command resolves a repository and credentials; getting both right on the first call is the difference between one command and a retry.

- **Repository.** Inside a Gitea checkout it comes from the `origin` remote.
  Outside one, pass `-R OWNER/NAME` on every command, or set `GITEA_AXI_REPO=OWNER/NAME` once for the session.
- **Credentials.** With `GITEA_AXI_TOKEN` and `GITEA_AXI_API_URL` set, authentication is automatic.
  Otherwise pass `--login <name>`, or set `GITEA_AXI_LOGIN`.

Outside a checkout with the token in the environment, `gitea-axi <command> -R OWNER/NAME …` is the whole invocation — don't look for a config file or a login profile.

## Commands

- `issue` — list, view, create, comment, edit, close, reopen, pin, and link (blocks / blocked-by).
- `pr` — list, view, create, comment, edit, review, merge, close, reopen, diff, checks, and checkout.
- `label` — list, create, edit, delete.
- `search issues "<query>"` and `search prs "<query>"` — full-text search (a bare `search "<query>"` is not valid).

## Finding and acting

Find the target, then act on it — two commands, not a survey of the repository.

- **Find it.** If you already know the number, act on it directly.
  Otherwise reach for one command — `search issues "<query>"` for a title or keyword, or `issue list --state all --label <name>` to narrow by a property — not both.
- **Read one issue or PR.** `issue view <number>` (or `pr view <number>`) shows labels and state by default, and takes `--fields assignees,milestone,…` for the rest.
  You do not need `issue list` to answer a question about a single known issue.
- **Act on it.** `issue edit <number>` and `pr edit <number>` change fields with repeatable `--add-label` / `--remove-label` and `--add-assignee` / `--remove-assignee`, plus `--title`, `--body`, and `--milestone`.
  Reviewing is `pr review <number>` with exactly one of `--approve`, `--request-changes`, or `--comment`, and an optional `--body`.
  A comment is `issue comment <number> --body <text>`; a new label is `label create --name <text> --color <hex-without-#>`.
