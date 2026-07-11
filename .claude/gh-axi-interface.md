# gh-axi Interface Reference

This document describes the complete user-facing interface of gh-axi as implemented in the source.
It is intended to be used as a conformance target for gitea-axi's implementation.

All output is TOON-encoded.
The TOON block type names (`pull_requests`, `issues`, `comment`, etc.) are exact — do not substitute synonyms.

---

## Table of Contents

1. [Invocation and Installation](#invocation-and-installation)
2. [Top-Level Flags](#top-level-flags)
3. [Repository and Host Targeting](#repository-and-host-targeting)
4. [Exit Codes](#exit-codes)
5. [Output Structure and TOON Encoding](#output-structure-and-toon-encoding)
6. [Count Line Format](#count-line-format)
7. [Truncation Behaviour](#truncation-behaviour)
8. [Suggestion / Help Lines](#suggestion--help-lines)
9. [Error Handling](#error-handling)
10. [Home / Dashboard](#home--dashboard)
11. [issue list](#issue-list)
12. [issue view](#issue-view)
13. [issue create](#issue-create)
14. [issue edit](#issue-edit)
15. [issue close](#issue-close)
16. [issue reopen](#issue-reopen)
17. [issue comment](#issue-comment)
18. [issue delete](#issue-delete)
19. [issue lock](#issue-lock)
20. [issue unlock](#issue-unlock)
21. [issue pin](#issue-pin)
22. [issue unpin](#issue-unpin)
23. [issue transfer](#issue-transfer)
24. [issue subissue add](#issue-subissue-add)
25. [issue subissue remove](#issue-subissue-remove)
26. [issue subissue list](#issue-subissue-list)
27. [pr list](#pr-list)
28. [pr view](#pr-view)
29. [pr create](#pr-create)
30. [pr edit](#pr-edit)
31. [pr close](#pr-close)
32. [pr merge](#pr-merge)
33. [pr review](#pr-review)
34. [pr checks](#pr-checks)
35. [pr diff](#pr-diff)
36. [pr checkout](#pr-checkout)
37. [pr ready](#pr-ready)
38. [pr reopen](#pr-reopen)
39. [pr comment](#pr-comment)
40. [pr update-branch](#pr-update-branch)
41. [pr revert](#pr-revert)
42. [label list](#label-list)
43. [label create](#label-create)
44. [label edit](#label-edit)
45. [label delete](#label-delete)

---

## Invocation and Installation

```
npx -y gh-axi <command> [subcommand] [args] [flags]
```

gh-axi requires the `gh` CLI installed and authenticated.
When `gh` is absent, the error code is `GH_NOT_INSTALLED` with the message:
`gh CLI is not installed — see https://cli.github.com`

---

## Top-Level Flags

These flags are processed by the SDK harness before any command runs.
They are accepted anywhere in the argument list after the binary name.

| Flag | Aliases | Description |
|------|---------|-------------|
| `--help` | `-h` | Show help for the current command |
| `--version` | `-v`, `-V` | Print the installed gh-axi version |
| `--repo <OWNER/NAME>` | `-R <OWNER/NAME>`, `--repo=<OWNER/NAME>`, `-R=<OWNER/NAME>` | Target a specific repository |
| `--hostname <host>` | `--hostname=<host>` | Target a custom GitHub Enterprise host |

The top-level help text is:

```
usage: gh-axi [command] [args] [flags]
commands[14]:
  (none)=dashboard, issue, pr, run, workflow, release, repo, label, project, secret, variable, search, api, setup
flags[4]:
  -R/--repo <OWNER/NAME> (after command), --hostname <host> (after command) or GH_HOST env, both flags accept space or equals form, --help, -v/-V/--version
examples:
  gh-axi
  gh-axi issue list --state open
  gh-axi issue list -R owner/name
  gh-axi issue list --repo=owner/name
  gh-axi issue list --hostname git.example.com
  gh-axi pr view 42
  gh-axi secret list
  gh-axi setup hooks
```

---

## Repository and Host Targeting

### -R / --repo flag

The `-R`/`--repo` flag must appear **after** the command (not before it):

```
gh-axi issue list -R owner/name          # correct
gh-axi issue list --repo owner/name      # correct
gh-axi issue list --repo=owner/name      # correct
gh-axi issue list -R=owner/name          # correct
gh-axi -R owner/name issue list          # WRONG — not accepted
```

The `search` command is the sole exception: `--repo` is passed through to the underlying `gh` call in addition to being used for context resolution.

The `repo view` subcommand additionally accepts exactly one positional repository argument (`gh-axi repo view owner/name`) as a compatibility exception for `gh repo view [<repository>]`.
Do not combine the positional form with `--repo`.

### --hostname flag

`--hostname` must also appear after the command.
An explicit `--hostname` flag takes precedence over the `GH_HOST` environment variable.
When `--hostname` is present, `GH_HOST` is set to its value for the lifetime of the child `gh` process.

### Suggestion -R injection rule

When the current repo context was **not** inferred from the local git checkout (i.e. `ctx.source !== "git"`), suggestion lines include the repo flag.
The flag is placed **after** `gh-axi` and **before** the sub-command tokens using the `-R owner/name` form.

Template strings in the suggestions source use the pattern:

```
`gh-axi${repoFlag(c)} issue view <number>`
```

which expands to `` `gh-axi -R owner/name issue view <number>` `` when a non-git repo is active.

Suggestion lines are then post-processed by `normalizeRepoFlagLine`, which rewrites the anti-pattern `` `gh-axi -R <repo> <command>` `` to `` `gh-axi <command> -R <repo>` `` (flag after command).

When `--hostname` was supplied via flag (not env), all backtick-wrapped `gh-axi` commands in suggestions are also suffixed with ` --hostname <host>`.

---

## Exit Codes

gh-axi inherits exit code semantics from `axi-sdk-js`.
Verified against `axi-sdk-js@0.1.8` source: `exitCodeForError` returns 2 for `VALIDATION_ERROR` and 1 for every other error.
The mapping by error code is:

| AxiError code | Exit code |
|---|---|
| `REPO_NOT_FOUND` | 1 |
| `NOT_FOUND` | 1 |
| `AUTH_REQUIRED` | 1 |
| `FORBIDDEN` | 1 |
| `VALIDATION_ERROR` | 2 |
| `RATE_LIMITED` | 1 |
| `GH_NOT_INSTALLED` | 1 |
| `UNKNOWN` | 1 |
| Success | 0 |

---

## Output Structure and TOON Encoding

All output is TOON-encoded.
The SDK function `renderOutput(blocks: string[])` joins multiple TOON blocks into a single output string.

Common block types used across commands:

- `renderList(name, items, schema)` — a labelled list block; the name becomes the TOON block key (e.g. `issues:`, `pull_requests:`, `labels:`)
- `renderDetail(name, item, schema)` — a single-entity detail block
- `renderHelp(lines)` — a `help:` block containing suggestion lines
- `renderError(message, code, suggestions)` — an error block
- `encode(object)` — raw TOON encoding of a plain object

### Field definitions (schema primitives)

| Primitive | Description |
|---|---|
| `field(key)` | Outputs `key: value` verbatim |
| `field(key, alias)` | Outputs `alias: value` using `key` as the data lookup |
| `lower(key)` | Outputs value lowercased |
| `pluck(key, subkey, alias)` | Navigates `item[key][subkey]`, outputs as `alias` |
| `relativeTime(key, alias)` | Converts ISO timestamp to relative time string, outputs as `alias` |
| `joinArray(key, subkey, alias)` | Joins an array of objects by extracting `subkey` from each, comma-separated |
| `boolYesNo(key, alias)` | Outputs `yes` or `no` for a boolean |
| `mapEnum(key, map, default, alias)` | Maps enum strings; unknown values become `default` |
| `custom(alias, fn)` | Calls `fn(item)` and outputs result as `alias` |

---

## Count Line Format

The `formatCountLine` function produces one of four exact phrases depending on context:

| Condition | Output |
|---|---|
| `apiLimitHit === true` | `count: N+ (GitHub search API limit reached)` |
| `totalCount` is known from GraphQL | `count: N of T total` |
| `count > displayLimit` (display truncation) | `count: N (showing first D)` |
| `count === limit && count > 0` (hit request limit, no GraphQL total) | `count: N (showing first N)` |
| Otherwise | `count: N` |

Where:
- `N` = number of items returned
- `T` = true total from GraphQL
- `D` = display limit

For `issue list` and `pr list`: when `count === limit` and a `RepoContext` is available, gh-axi makes a GraphQL query for `totalCount`.
If the GraphQL call succeeds, the `count: N of T total` form is used.
If it fails, it falls back to `count: N (showing first N)`.

---

## Truncation Behaviour

### Body truncation (issues and PRs)

The `truncateBody(text, limit)` function truncates the body field.

- Issue `view` default schema: body truncated at **500 characters**.
- PR `view` default schema: body truncated at **500 characters**.
- Issue `comment` result schema: body truncated at **800 characters**.

When `--full` is passed to `issue view` or `pr view`, the body is output in full without truncation.

The exact hint text appended when truncation occurs is not directly visible in the schema — it is returned by `truncateBody` from `body.ts` (not provided in the fetched sources).
The `--full` flag is the documented way to bypass truncation.

### PR diff truncation

The `pr diff` subcommand truncates at **4000 characters** by default.
When truncated:
- The block contains `truncated: true` and `original_length: N`
- A suggestion is prepended: `` Run `gh-axi pr diff <num> --full` to see the complete diff ``
  (with `-R owner/name` injected if non-git repo context)

When `--full` is passed, the full diff is output.

### Workflow log truncation

`run view --log` and `run view --log-failed` truncate at **20,000 characters** (tail kept).
When truncated, the complete log is best-effort saved to a temp file and exposed as a `full_log` field.
A `help:` hint tells agents to grep that file for earlier context.

---

## Suggestion / Help Lines

Every command ends with a `help:` block produced by `renderHelp(suggestions)`.
The suggestions are looked up from a static table by `(domain, action, isEmpty?, state?, id?)`.

Empty suggestions produce an empty `help:` block (not omitted).

### Issue suggestions

| Trigger | Suggestions |
|---|---|
| `issue list`, not empty | `` Run `gh-axi issue view <number>` to view details `` / `` Run `gh-axi issue create --title "..." --body-file <path>` to create `` |
| `issue list`, empty | `` Run `gh-axi issue create --title "..." --body-file <path>` to create an issue `` / `` Run `gh-axi issue list --state closed` to see closed issues `` |
| `issue view`, state=open | Comment / close / assign / search PRs suggestions |
| `issue view`, state=closed | Reopen / comment / search PRs suggestions |
| `issue create` | View / label suggestions with `id` filled |
| `issue edit` | `` Run `gh-axi issue view <id>` to see updated issue `` |
| `issue close` | `` Run `gh-axi issue reopen <id>` to reopen `` |
| `issue reopen` | Close / view suggestions |
| `issue comment` | `` Run `gh-axi issue view <id> --comments` to see all comments `` |
| `issue delete` | `` Run `gh-axi issue list` to see remaining issues `` |
| `issue lock`, `unlock`, `pin`, `unpin` | `` Run `gh-axi issue view <id>` to see issue details `` |
| `issue transfer` | (empty) |

### PR suggestions

| Trigger | Suggestions |
|---|---|
| `pr list`, not empty | View / create suggestions |
| `pr list`, empty | Create / closed-state suggestions |
| `pr view`, state=open | Checks / approve / merge suggestions |
| `pr view`, state=closed | `` Run `gh-axi pr reopen <id>` to reopen `` |
| `pr view`, state=merged | `` Run `gh-axi pr revert <id>` to revert `` |
| `pr create` | View / checks suggestions with `id` filled |
| `pr edit` | View suggestion |
| `pr close` | Reopen suggestion |
| `pr merge` | Revert suggestion |
| `pr review` | View suggestion |
| `pr checks` | View / merge suggestions |
| `pr diff` | Approve suggestion (plus truncation hint if truncated) |
| `pr checkout` | (empty) |
| `pr ready` | View suggestion |
| `pr reopen` | View suggestion |
| `pr comment` | `` Run `gh-axi pr view <id> --comments` to see all comments `` |
| `pr update-branch` | `` Run `gh-axi pr checks <id>` to monitor CI after update `` |
| `pr revert` | `` Run `gh-axi pr view <id>` to see the revert PR `` |

### Label suggestions

| Trigger | Suggestions |
|---|---|
| `label list` | `` Run `gh-axi label create --name "..." --color "..."` to create a label `` |
| `label create` | `` Run `gh-axi label list` to see all labels `` |
| `label edit` | `` Run `gh-axi label list` to see all labels `` |
| `label delete` | `` Run `gh-axi label list` to see remaining labels `` |

### Home suggestions

```
Run `gh-axi <command> <subcommand>` — commands: issue, pr, run, release, repo, label, secret, variable`
```

Additionally, if `issues.length >= 3`, a hint is prepended:
```
Run `gh-axi issue list` for full issue list
```

If `prs.length >= 3`, a hint is prepended:
```
Run `gh-axi pr list` for full PR list
```

---

## Error Handling

### AxiError codes

gh-axi defines these error codes (string literals):

```
REPO_NOT_FOUND | NOT_FOUND | AUTH_REQUIRED | FORBIDDEN |
VALIDATION_ERROR | RATE_LIMITED | GH_NOT_INSTALLED | UNKNOWN
```

### mapGhError — pattern-matched gh stderr

When a `gh` subprocess fails, `mapGhError(stderr, exitCode)` converts the raw stderr to a structured `AxiError`:

| Matched pattern | Code | Message |
|---|---|---|
| `Could not resolve to a Repository with the name '<name>'` | `REPO_NOT_FOUND` | `Repository "<name>" not found` |
| `Could not resolve to an? ... with the number of N` | `NOT_FOUND` | `Item #N does not exist in this repository` |
| `issue N not found` (case-insensitive) | `NOT_FOUND` | `Issue #N does not exist` |
| `pull request N not found` (case-insensitive) | `NOT_FOUND` | `Pull request #N does not exist` |
| `release with tag "T" not found` (case-insensitive) | `NOT_FOUND` | `Release "T" not found` |
| `run N not found` (case-insensitive) | `NOT_FOUND` | `Run N not found` |
| `gh auth login` (appears in stderr) | `AUTH_REQUIRED` | `GitHub auth required — run \`gh auth login\` first` |
| `authentication token is missing required scopes [S]` | `FORBIDDEN` | `GitHub token is missing required scope(s): S` |
| `secondary rate limit` | `RATE_LIMITED` | `GitHub secondary rate limit hit — wait ~60s and retry` |
| `API rate limit ... exceeded` | `RATE_LIMITED` | `GitHub API rate limit exceeded` |
| `sub-issue is already a sub-issue of issue with number N` | `VALIDATION_ERROR` | `Issue is already a sub-issue of #N` |
| `sub-?issue.*?(cycle\|circular)` | `VALIDATION_ERROR` | `Cannot add sub-issue: would create a cycle` |
| `issue cannot be a sub-?issue of itself` | `VALIDATION_ERROR` | `An issue cannot be a sub-issue of itself` |
| `HTTP 403` | `FORBIDDEN` | `Insufficient permissions for this action` |
| `HTTP 422` | `VALIDATION_ERROR` | Extracted `"message"` field from JSON body, or `Validation error` |
| `not found` (generic fallback, case-insensitive) | `NOT_FOUND` | First line of stderr |
| (no match) | `UNKNOWN` | First line of stderr, or `gh exited with code N` |

### Validation errors (argument-level)

These are thrown by command handlers before calling `gh`:

| Command | Condition | Message |
|---|---|---|
| `issue list` | `--search` flag present | `issue list does not support --search. Use \`gh-axi search issues "<query>"\` instead for full-text search with total counts.` |
| `pr list` | `--search` flag present | `pr list does not support --search. Use \`gh-axi search prs "<query>"\` instead for full-text search with total counts.` |
| `issue create` | `--title` absent | `--title is required` |
| `pr create` | `--title` absent | `--title is required` |
| `issue comment` | `--body` / `--body-file` absent | (from `takeBody` with `required: true`) |
| `pr comment` | `--body` / `--body-file` absent | (from `takeBody` with `required: true`) |
| `issue transfer` | `--to-repo` absent | `--to-repo is required for transfer` |
| `label create` | `--name` absent | `--name is required: gh-axi label create --name "..." --color "..."` |
| `label create` | `--color` absent | `--color is required: gh-axi label create --name "..." --color "..."` |
| `label edit` | positional name absent | `Label name is required: gh-axi label edit <name>` |
| `label delete` | positional name absent | `Label name is required: gh-axi label delete <name>` |
| `pr merge` | multiple method flags | `Choose only one merge method: --merge, --squash, or --rebase` |
| `pr merge` | `--method` and shorthand conflict | `Choose either --method or a matching merge method shorthand, not both` |
| `pr merge` | invalid `--method` value | `--method must be one of: merge, squash, rebase` |
| `issue subissue add` | no `--repo` context | `Could not determine repository — pass --repo <owner/name> or run inside a git checkout` |
| `issue subissue add` | no child numbers | `subissue add requires at least one child issue number` |
| `issue subissue remove` | no `--repo` context | `Could not determine repository — pass --repo <owner/name> or run inside a git checkout` |
| `issue subissue remove` | no child number | `subissue remove requires a child issue number` |
| `issue subissue list` | no `--repo` context | `Could not determine repository — pass --repo <owner/name> or run inside a git checkout` |
| `issue view`, `issue edit`, etc. | numeric arg missing | `Missing issue number` |
| `pr view`, `pr merge`, etc. | numeric arg missing | `Missing PR number` |
| issue type invalid | type name not found | `Unknown issue type "<name>". Available types: A, B, C` |
| issue type not configured | no types configured | `Issue types are not configured for this repository. Enable them in repo settings before using --type.` |

### Unknown subcommand errors

| Command | Message | Code | Suggestions |
|---|---|---|---|
| `issue <unknown>` | `Unknown issue subcommand: <sub>` | `VALIDATION_ERROR` | `Run \`gh-axi issue --help\` for usage` |
| `issue subissue <unknown>` | `Unknown subissue subcommand: <sub>` | `VALIDATION_ERROR` | `Run \`gh-axi issue subissue --help\` for usage` |
| `pr <unknown>` | `Unknown pr subcommand: <sub>` | `VALIDATION_ERROR` | `Run \`gh-axi pr --help\` to see available subcommands` |
| `label <unknown>` | `Unknown subcommand: <sub>` | `VALIDATION_ERROR` | `Available subcommands: list, create, edit, delete` |

---

## Home / Dashboard

**Invocation:** `gh-axi` (no command)

Runs `issue list` and `pr list` in parallel, each limited to 3 items.

### Output structure

```
repo: owner/name          ← only when RepoContext is present
issues:
  - number: 1
    title: ...
    state: open
    author: alice
prs:
  - number: 42
    title: ...
    author: bob
    review: none
help:
  - Run `gh-axi issue list` for full issue list   ← only when issues.length >= 3
  - Run `gh-axi pr list` for full PR list          ← only when prs.length >= 3
  - Run `gh-axi <command> <subcommand>` — commands: issue, pr, run, release, repo, label, secret, variable
```

When there are no open issues: `issues: 0 open` (raw string, not a list block).
When there are no open PRs: `prs: 0 open` (raw string, not a list block).

### Issue schema (home)

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |
| `author` | `author.login` |

### PR schema (home)

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `author` | `author.login` |
| `review` | `reviewDecision` mapped: `APPROVED`→`approved`, `CHANGES_REQUESTED`→`changes_requested`, `REVIEW_REQUIRED`→`required`, otherwise→`none` |

---

## issue list

**Invocation:** `gh-axi issue list [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--state <open\|closed\|all>` | string | (not passed; gh default is `open`) | no |
| `--label <name>` | string | — | no |
| `--assignee <login>` | string | — | no |
| `--author <login>` | string | — | no |
| `--milestone <name>` | string | — | no |
| `--sort <created\|updated\|comments>` | string | — | no |
| `--limit <n>` | integer | `30` | no |
| `--fields <a,b,c>` | comma-separated | — | no |
| `--search` | boolean | — | forbidden (throws `VALIDATION_ERROR`) |

Note: `--sort` is implemented by appending `--search sort:<value>-desc` to the underlying `gh issue list` call.

### Default output fields

TOON block name: `issues`

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |
| `author` | `author.login` |
| `created` | `createdAt` as relative time |

### Extra fields via --fields

| Name | Output field | Source |
|---|---|---|
| `body` | `body` | `body` verbatim |
| `closedAt` | `closed_at` | `closedAt` as relative time |
| `labels` | `labels` | `labels[].name` joined |
| `milestone` | `milestone` | `milestone.title` |
| `updatedAt` | `updated_at` | `updatedAt` as relative time |
| `url` | `url` | `url` verbatim |

### Output structure

```
count: N [of T total | (showing first N)]
issues:
  - number: 1
    title: Fix login bug
    state: open
    author: alice
    created: 2 days ago
help:
  - Run `gh-axi issue view <number>` to view details
  - Run `gh-axi issue create --title "..." --body-file <path>` to create
```

### Empty state

When no issues are found, `count: 0` is shown and the list block is empty.
The `help:` suggestions switch to the empty-list variant:
```
help:
  - Run `gh-axi issue create --title "..." --body-file <path>` to create an issue
  - Run `gh-axi issue list --state closed` to see closed issues
```

### Count line

- If `count < limit`: `count: N`
- If `count === limit` and GraphQL succeeds: `count: N of T total`
- If `count === limit` and GraphQL fails: `count: N (showing first N)`

---

## issue view

**Invocation:** `gh-axi issue view <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--comments` | boolean | false | no |
| `--full` | boolean | false | no |

### Default output fields

TOON block name: `issue`

| Output field | Source | Notes |
|---|---|---|
| `number` | `number` | |
| `title` | `title` | |
| `state` | `state` lowercased | |
| `author` | `author.login` | |
| `created` | `createdAt` as relative time | |
| `type` | `issueType.name` | `"none"` if issueType absent/empty; field omitted entirely if the host does not support `issueType` in `gh issue view --json` |
| `body` | `body` truncated at 500 chars | Full text when `--full` is passed |
| `subissues` | GraphQL sub-issues | e.g. `["#20", "#101"]`; omitted if no sub-issues |
| `parent` | GraphQL parent | e.g. `"#16"`; omitted if no parent |

Sub-issue and parent fields require `RepoContext`.
If the GraphQL call for sub-issue relationships fails, those fields are silently omitted.

### Comments output

When `--comments` is passed, a separate `comments` list block is appended:

TOON block name: `comments`

| Output field | Source |
|---|---|
| `author` | `comments[].author.login` |
| `created` | `comments[].createdAt` as relative time |
| `body` | `comments[].body` truncated at 800 chars |

Note: the `number` (issue) field is **not** shown in the comment list when rendered as a sub-block.

---

## issue create

**Invocation:** `gh-axi issue create --title <text> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--title <text>` | string | — | **yes** |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |
| `--assignee <login>` | string | — | no |
| `--label <name>` | string (repeatable) | — | no |
| `--milestone <name>` | string | — | no |
| `--project <name>` | string | — | no |
| `--type <name>` | string | — | no |

`--body` and `--body-file` are mutually exclusive alternatives (handled by `takeBody`).

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |
| `url` | `url` |
| `type` | `issueType.name` — only present when `--type` was supplied |

### Idempotency

`issue create` is **not** idempotent.
Each call creates a new issue regardless of title or content.

### Suggestions

After creation, `id` is set to the newly created issue number:
```
help:
  - Run `gh-axi issue view <new-number>` to see the full issue
  - Run `gh-axi issue edit <new-number> --add-label <label>` to label
```

---

## issue edit

**Invocation:** `gh-axi issue edit <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--title <text>` | string | — | no |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |
| `--add-label <name>` | string | — | no |
| `--remove-label <name>` | string | — | no |
| `--add-assignee <login>` | string | — | no |
| `--remove-assignee <login>` | string | — | no |
| `--milestone <name>` | string | — | no |
| `--type <name>` | string | — | no |
| `--no-type` | boolean | false | no |

`--type` and `--no-type` are mutually exclusive.
`--no-type` removes the issue type (sets `issueTypeId: null` via GraphQL).

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |
| `labels` | `labels[].name` joined |
| `assignees` | `assignees[].login` joined |
| `type` | `issueType.name` — only present when `--type` or `--no-type` was supplied |

### Implementation note

If no non-type fields are provided (only `--type` or `--no-type`), the underlying `gh issue edit` call is **skipped** and only the GraphQL type mutation is performed.

---

## issue close

**Invocation:** `gh-axi issue close <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--reason <completed\|not_planned>` | string | — | no |
| `--comment <text>` | string | — | no |

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |

### Idempotency

If the issue is already closed, the command returns without calling `gh issue close`.
Output adds a `message: Already closed` field:

```
issue:
  number: 42
  state: closed
  message: Already closed
```

---

## issue reopen

**Invocation:** `gh-axi issue reopen <number>`

### Flags

None.

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |

### Idempotency

If the issue is already open, the command returns without calling `gh issue reopen`.
Output adds `message: Already open`:

```
issue:
  number: 42
  state: open
  message: Already open
```

---

## issue comment

**Invocation:** `gh-axi issue comment <number> --body <text>`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--body <text>` | string | — | **yes** |
| `--body-file <path>` | path | — | **yes** (alternative to `--body`) |

Either `--body` or `--body-file` must be supplied.

### Default output fields

TOON block name: `comment`

| Output field | Source |
|---|---|
| `issue` | issue number (via `field("number", "issue")`) |
| `author` | `author.login` of the newly created comment |
| `created` | `createdAt` of the new comment as relative time |
| `body` | comment body truncated at 800 chars |

The comment data is retrieved by fetching all comments and taking the last one.

---

## issue delete

**Invocation:** `gh-axi issue delete <number>`

### Flags

None.
The underlying `gh issue delete --yes` is called (no confirmation prompt).

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` (the deleted issue number) |
| `status` | literal string `"deleted"` |

---

## issue lock

**Invocation:** `gh-axi issue lock <number>`

### Flags

None.

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |
| `locked` | boolean |

### Idempotency

If the issue is already locked, no `gh` call is made.
Output adds `message: Already locked`.

---

## issue unlock

**Invocation:** `gh-axi issue unlock <number>`

### Flags

None.

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |
| `locked` | boolean |

### Idempotency

If the issue is already unlocked, no `gh` call is made.
Output adds `message: Already unlocked`.

---

## issue pin

**Invocation:** `gh-axi issue pin <number>`

### Flags

None.

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |
| `pinned` | `isPinned` boolean (output key is `pinned`, source field is `isPinned`) |

### Idempotency

If the issue is already pinned, no `gh` call is made.
Output adds `message: Already pinned`.

---

## issue unpin

**Invocation:** `gh-axi issue unpin <number>`

### Flags

None.

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `state` lowercased |
| `pinned` | `isPinned` boolean (output key is `pinned`) |

### Idempotency

If the issue is already unpinned, no `gh` call is made.
Output adds `message: Already unpinned`.

---

## issue transfer

**Invocation:** `gh-axi issue transfer <number> --to-repo <owner/name>`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--to-repo <owner/name>` | string | — | **yes** |

When transferring across repos, use `-R source/repo` to set the source and `--to-repo dest/repo` for the destination:
```
gh-axi issue transfer 42 -R source/repo --to-repo dest/repo
```

### Default output fields

TOON block name: `issue`

| Output field | Source |
|---|---|
| `number` | new number in destination repo (or original if lookup fails) |
| `url` | URL of the transferred issue in the destination repo |

### Idempotency

Not idempotent.
Transfer is a one-way operation; errors come from `gh`.

### Suggestions

Transfer always produces empty suggestions (the table entry returns `[]`).

---

## issue subissue add

**Invocation:** `gh-axi issue subissue add <parent> <child> [<child> ...]`

Requires `RepoContext` (pass `-R owner/name` if not in a git checkout).

### Arguments

| Argument | Description |
|---|---|
| `<parent>` | Issue number of the parent |
| `<child> [<child> ...]` | One or more child issue numbers |

### Default output fields

TOON block name: `subissue_add`

| Output field | Source |
|---|---|
| `parent` | `"#<parentNumber>"` |
| `added` | array of `"#<number>"` strings for each successfully added child |

### Suggestion

```
Run `gh-axi issue view <parent-number>` to see the parent with its sub-issues
```

### Error behaviour

If adding a subsequent child fails after some children were already added, the error message includes:
```
<original error message>
Added before failure: #N1, #N2
```

---

## issue subissue remove

**Invocation:** `gh-axi issue subissue remove <parent> <child>`

Requires `RepoContext`.

### Arguments

| Argument | Description |
|---|---|
| `<parent>` | Issue number of the parent |
| `<child>` | Issue number of the child to remove |

### Default output fields

TOON block name: `subissue_remove`

| Output field | Source |
|---|---|
| `parent` | `"#<parentNumber>"` |
| `removed` | `"#<childNumber>"` |

### Idempotency

No idempotency check.
If the child is not a sub-issue, the GraphQL mutation returns an error which propagates as-is.

### Suggestion

```
Run `gh-axi issue subissue list <parent-number>` to see remaining sub-issues
```

---

## issue subissue list

**Invocation:** `gh-axi issue subissue list <parent>`

Requires `RepoContext`.
Fetches up to **100** sub-issues via GraphQL.

### Arguments

| Argument | Description |
|---|---|
| `<parent>` | Issue number of the parent |

### Default output fields

Count line appears first, then:

Header line (raw string): `parent: #<parentNumber>`

TOON block name: `subissues`

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |

### Count line

Uses `formatCountLine` with `limit: 100` and `totalCount` from GraphQL.
So if there are exactly 100 sub-issues, the count line will show `count: 100 of T total` if totalCount is available.

---

## pr list

**Invocation:** `gh-axi pr list [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--state <open\|closed\|all>` | string | `open` | no |
| `--label <name>` | string | — | no |
| `--assignee <login>` | string | — | no |
| `--author <login>` | string | — | no |
| `--base <branch>` | string | — | no |
| `--head <branch>` | string | — | no |
| `--draft` | boolean | false | no |
| `--limit <n>` | integer | `30` | no |
| `--fields <a,b,c>` | comma-separated | — | no |
| `--search` | — | — | forbidden (throws `VALIDATION_ERROR`) |

Note: `--state` defaults to `"open"` (always passed to `gh pr list`).

### Default output fields

TOON block name: `pull_requests`

| Output field | Source |
|---|---|
| `number` | `number` |
| `title` | `title` |
| `state` | `state` lowercased |
| `author` | `author.login` |
| `draft` | `isDraft` as `yes`/`no` |
| `review` | `reviewDecision` mapped: `APPROVED`→`approved`, `CHANGES_REQUESTED`→`changes_requested`, `REVIEW_REQUIRED`→`required`, otherwise→`none` |

### Extra fields via --fields

| Name | Output field | Source |
|---|---|---|
| `body` | `body` | `body` verbatim |
| `createdAt` | `created` | `createdAt` as relative time |
| `labels` | `labels` | `labels[].name` joined |
| `milestone` | `milestone` | `milestone.title` |
| `mergedAt` | `merged_at` | `mergedAt` as relative time |
| `url` | `url` | `url` verbatim |

### Count line

Same logic as `issue list`.
For `--state closed`, the GraphQL query filters `states:[CLOSED,MERGED]`.
For `--state all`, no `states` filter is applied.

### Empty state message

When `count: 0`, the help suggestions switch to:
```
help:
  - Run `gh-axi pr create --title "..." --body-file <path>` to create a PR
  - Run `gh-axi pr list --state closed` to see closed PRs
```

---

## pr view

**Invocation:** `gh-axi pr view <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--comments` | boolean | false | no |
| `--reviews` | boolean | false | no |
| `--full` | boolean | false | no |

### Default output fields

TOON block name: `pull_request`

| Output field | Source | Notes |
|---|---|---|
| `number` | `number` | |
| `title` | `title` | |
| `state` | `state` lowercased | |
| `author` | `author.login` | |
| `draft` | `isDraft` as `yes`/`no` | |
| `merged` | computed | `"no"` if not merged; `mergedAt` value if state is `MERGED` |
| `checks` | computed from `statusCheckRollup` | `"N passed, N failed[, N skipped], N total"` or `"0 passed, 0 failed — this PR has no CI checks configured"` |
| `body` | `body` truncated at 500 chars | Full text when `--full` |
| `comment_count` | computed | `"N — use --comments to see full comments"` (when `--comments` not passed) |
| `comments` | full array | Present only when `--comments` is passed (replaces `comment_count`) |
| `review_count` | computed | `"N — use --reviews to see full reviews"` (when `--reviews` not passed) |
| `reviews` | full array | Present only when `--reviews` is passed (replaces `review_count`) |

### checks field format

When checks are configured:
```
checks: 3 passed, 1 failed, 1 skipped, 5 total
```

When no checks are configured:
```
checks: 0 passed, 0 failed — this PR has no CI checks configured
```

CI check classification:
- `pass`: conclusion is `SUCCESS` or `NEUTRAL`
- `fail`: conclusion is `FAILURE`, `TIMED_OUT`, or `ACTION_REQUIRED`
- `skip`: conclusion is `SKIPPED` or `CANCELLED`, or state/status is `EXPECTED` or `NEUTRAL`
- `pending`: everything else

### merged field format

- PR not merged: `merged: no`
- PR merged: `merged: <mergedAt-ISO-string>` (the raw `mergedAt` value, not relative time)

### comments block (when --comments)

The `comments` field contains an array of objects:
```
comments:
  - author: alice
    body: <comment text>
    created: <createdAt ISO string>
```

### reviews block (when --reviews)

The `reviews` field is populated via REST API (`/pulls/{num}/reviews` and `/pulls/{num}/comments`).
Each review object:
```
reviews:
  - author: alice
    state: approved
    submitted: <submitted_at ISO string>
    body: <review body>
    inline_comments:
      - author: alice
        path: src/foo.ts
        line: 42
        body: <comment text>
        created: <created_at ISO string>
```

Review states are mapped from the REST API values:
`APPROVED`→`approved`, `CHANGES_REQUESTED`→`changes_requested`, `COMMENTED`→`commented`, `DISMISSED`→`dismissed`, `PENDING`→`pending`.

### Suggestions

View suggestions are state-dependent.
The `pr view` handler itself does not call `getSuggestions` (no `renderHelp` block in `prView`).
**There are no help suggestions on `pr view` output.**

---

## pr create

**Invocation:** `gh-axi pr create --title <text> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--title <text>` | string | — | **yes** |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |
| `--base <branch>` | string | — | no |
| `--head <branch>` | string | — | no |
| `--draft` | boolean | false | no |
| `--assignee <login>` | string | — | no |
| `--reviewer <login>` | string | — | no |
| `--label <name>` | string (repeatable) | — | no |
| `--milestone <name>` | string | — | no |
| `--project <name>` | string | — | no |

### Default output fields

TOON block name: `created`

| Output field | Source |
|---|---|
| `number` | Parsed from URL output of `gh pr create` (or the URL string itself if parsing fails) |
| `url` | Last line of `gh pr create` stdout |

### Suggestions

```
help:
  - Run `gh-axi pr view <new-number>` to see the full PR
  - Run `gh-axi pr checks <new-number>` to monitor CI
```

---

## pr edit

**Invocation:** `gh-axi pr edit <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--title <text>` | string | — | no |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |
| `--add-label <name>` | string | — | no |
| `--remove-label <name>` | string | — | no |
| `--add-assignee <login>` | string | — | no |
| `--remove-assignee <login>` | string | — | no |
| `--add-reviewer <login>` | string | — | no |
| `--remove-reviewer <login>` | string | — | no |
| `--milestone <name>` | string | — | no |
| `--base <branch>` | string | — | no |

### Default output fields

TOON block name: `edited`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

---

## pr close

**Invocation:** `gh-axi pr close <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--comment <text>` | string | — | no |

### Default output fields (success)

TOON block name: `closed`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

### Idempotency

If the PR state is already `CLOSED` or `MERGED`, no `gh` call is made.
Output uses block name `pull_request` instead:

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | lowercased state |
| `already` | boolean `true` |

---

## pr merge

**Invocation:** `gh-axi pr merge <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--method <merge\|squash\|rebase>` | string | — | no |
| `--merge` | boolean | false | no (shorthand for `--method merge`) |
| `--squash` | boolean | false | no (shorthand for `--method squash`) |
| `--rebase` | boolean | false | no (shorthand for `--method rebase`) |
| `--auto` | boolean | false | no |
| `--delete-branch` | boolean | false | no |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |
| `--subject <text>` | string | — | no |

Specifying multiple shorthand flags or conflicting `--method` + shorthand raises `VALIDATION_ERROR`.

### Default output fields (success)

TOON block name: `merged`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |
| `method` | the merge method used, or `"default"` if none was specified |

### Idempotency

If the PR is already merged, returns without calling `gh`.
Block name: `pull_request`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `"merged"` |
| `merged_by` | `mergedBy.login` or `null` |
| `merged_at` | `mergedAt` or `null` |

---

## pr review

**Invocation:** `gh-axi pr review <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--approve` | boolean | false | no |
| `--request-changes` | boolean | false | no |
| `--comment` | boolean | false | no |
| `--body <text>` | string | — | no |
| `--body-file <path>` | path | — | no |

### Default output fields

TOON block name: `review`

| Output field | Source |
|---|---|
| `number` | `number` |
| `action` | `"approved"` / `"changes_requested"` / `"commented"` based on which flag was passed |

---

## pr checks

**Invocation:** `gh-axi pr checks <number>`

### Flags

None.

### Default output fields

When no checks are configured (zero checks):
```
checks: 0 passed, 0 failed — this PR has no CI checks configured
```
(Raw TOON-encoded object, no list block)

When checks exist:

First block (raw object):
```
summary: N passed, N failed[, N skipped][, N pending], N total
```

Then TOON list block name: `checks`

| Output field | Source |
|---|---|
| `name` | `check.name ?? check.context ?? "check"` |
| `conclusion` | one of `pass`, `fail`, `skip`, `pending` |

---

## pr diff

**Invocation:** `gh-axi pr diff <number> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--full` | boolean | false | no |

### Output

Raw TOON-encoded object with key `pr_diff`:

| Field | Source |
|---|---|
| `number` | `number` |
| `diff` | diff text (truncated to 4000 chars unless `--full`) |
| `truncated` | boolean `true` — only present when truncated |
| `original_length` | integer — only present when truncated |

### Truncation hint

When truncated, prepended to suggestions (before any other suggestions):
```
Run `gh-axi pr diff <num> --full` to see the complete diff
```
(With `-R owner/name` injected if non-git repo context.)

---

## pr checkout

**Invocation:** `gh-axi pr checkout <number>`

### Flags

None.

### Default output fields

TOON block name: `checkout`

| Output field | Source |
|---|---|
| `number` | `number` |
| `branch` | Branch name parsed from `gh pr checkout` stdout (`Switched to branch '<name>'`), or raw stdout if not matched |
| `status` | literal `"ok"` |

### Suggestions

Empty (the table entry returns `[]`).

---

## pr ready

**Invocation:** `gh-axi pr ready <number>`

### Flags

None.

Marks a draft PR as ready for review.

### Default output fields (success)

TOON block name: `ready`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

### Idempotency

If the PR is already not a draft, no `gh` call is made.
Block name: `pull_request`

| Output field | Source |
|---|---|
| `number` | `number` |
| `draft` | `"no"` |
| `already` | boolean `true` |

---

## pr reopen

**Invocation:** `gh-axi pr reopen <number>`

### Flags

None.

### Default output fields (success)

TOON block name: `reopened`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

### Idempotency

If the PR is already open, no `gh` call is made.
Block name: `pull_request`

| Output field | Source |
|---|---|
| `number` | `number` |
| `state` | `"open"` |
| `already` | boolean `true` |

---

## pr comment

**Invocation:** `gh-axi pr comment <number> --body <text>`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--body <text>` | string | — | **yes** |
| `--body-file <path>` | path | — | **yes** (alternative) |

### Default output fields

TOON block name: `commented`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

---

## pr update-branch

**Invocation:** `gh-axi pr update-branch <number>`

### Flags

None.

### Default output fields

TOON block name: `updated`

| Output field | Source |
|---|---|
| `number` | `number` |
| `status` | literal `"ok"` |

---

## pr revert

**Invocation:** `gh-axi pr revert <number>`

### Flags

None.

### Default output fields

TOON block name: `reverted`

The fields differ depending on which code path succeeded:

**If `gh pr revert` CLI command exists and succeeds:**

| Output field | Source |
|---|---|
| `number` | original PR number |
| `revert_pr` | new revert PR number parsed from URL, or `null` |
| `status` | literal `"ok"` |

**If falling back to REST API:**

| Output field | Source |
|---|---|
| `number` | original PR number |
| `revert_pr` | `number` from API response, or `null` |
| `url` | `html_url` from API response, or `null` |
| `status` | literal `"ok"` |

---

## label list

**Invocation:** `gh-axi label list [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--limit <n>` | integer | `500` | no |

### Default output fields

TOON block name: `labels`

| Output field | Source |
|---|---|
| `name` | `name` |

### Output structure

```
count: N [(showing first N)]
labels:
  - name: bug
  - name: enhancement
help:
  - Run `gh-axi label create --name "..." --color "..."` to create a label
```

### Count line

Uses `formatCountLine` with `limit` as provided (default 500).
No GraphQL total-count lookup.
So if exactly 500 labels are returned: `count: 500 (showing first 500)`.

### Empty state

When `count: 0`, the list block has no items.
Suggestions remain the same (the table has no empty-specific entry for labels).

---

## label create

**Invocation:** `gh-axi label create --name <text> --color <hex> [flags]`

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--name <text>` | string | — | **yes** |
| `--color <hex>` | string (hex without `#`) | — | **yes** |
| `--description <text>` | string | — | no |

### Default output fields

TOON block name (success): raw TOON object
```
created: ok
label: <name>
```

### Idempotency

Before creating, gh-axi checks if a label with the same name already exists (case-insensitive comparison).
If found, no `gh` call is made and the output is:

```
create: already_exists
label: <existing-label-name>
```

Note: the output field is `create` (not `created`) in the already-exists case.

---

## label edit

**Invocation:** `gh-axi label edit <name> [flags]`

`<name>` is the first positional argument after the `edit` subcommand.

### Flags

| Flag | Type | Default | Required |
|---|---|---|---|
| `--name <text>` | string | — | no |
| `--color <hex>` | string | — | no |
| `--description <text>` | string | — | no |

### Default output fields

TOON block name: raw TOON object
```
edit: ok
label: <new-name-or-original-name>
```

The `label` field shows the new name if `--name` was supplied, otherwise the original positional name.

---

## label delete

**Invocation:** `gh-axi label delete <name>`

`<name>` is the first positional argument after the `delete` subcommand.
The underlying `gh label delete --yes` is called (no confirmation prompt).

### Flags

None.

### Default output fields

TOON block name: raw TOON object
```
delete: ok
label: <name>
```

### Idempotency

No idempotency check.
If the label does not exist, `gh label delete` returns an error which propagates as a mapped `AxiError`.

---

## Appendix: Issue Help Text

```
usage: gh-axi issue <subcommand> [flags]
subcommands[14]:
  list, view <number>, create, edit <number>, close <number>, reopen <number>, comment <number>, delete <number>, lock <number>, unlock <number>, pin <number>, unpin <number>, transfer <number>, subissue <add|remove|list>
flags{list}:
  --state <open|closed|all>, --label <name>, --assignee <login>, --author <login>, --milestone <name>, --sort <created|updated|comments>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text> or --body-file <path>, --assignee <login>, --label <name> (repeatable), --milestone <name>, --type <name>
flags{edit}:
  --title, --body <text> or --body-file <path>, --add-label, --remove-label, --add-assignee, --remove-assignee, --milestone, --type <name>, --no-type
flags{close}:
  --reason <completed|not_planned>, --comment <text>
flags{comment}:
  --body <text> or --body-file <path> (required)
flags{transfer}:
  --to-repo <owner/name> (required)
subissue:
  add <parent> <child> [<child> ...], remove <parent> <child>, list <parent>
examples:
  gh-axi issue list --state closed --label bug
  gh-axi issue view 42 --comments
  gh-axi issue create --title "Fix login" --body "Steps to reproduce..."
  gh-axi issue comment 42 --body-file comment.md
  gh-axi issue close 42 --reason completed
  gh-axi issue transfer 42 -R source/repo --to-repo dest/repo
  gh-axi issue subissue add 16 20 101 125
  gh-axi issue subissue list 16
```

## Appendix: PR Help Text

```
usage: gh-axi pr <subcommand> [flags]
subcommands[15]:
  list, view <number>, create, edit <number>, close <number>, merge <number>, review <number>, checks <number>, diff <number>, checkout <number>, ready <number>, reopen <number>, comment <number>, update-branch <number>, revert <number>
flags{list}:
  --state <open|closed|all>, --label, --assignee, --author, --base, --head, --draft, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --reviews (show review submissions and inline review comments), --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text> or --body-file <path>, --base, --head, --draft, --assignee, --reviewer, --label <name> (repeatable), --milestone
flags{edit}:
  --title <text>, --body <text> or --body-file <path>, --add-label, --remove-label, --add-assignee, --remove-assignee, --add-reviewer, --remove-reviewer, --milestone
flags{merge}:
  --method <merge|squash|rebase>, --merge, --squash, --rebase, --auto, --delete-branch, --body <text> or --body-file <path>, --subject
flags{review}:
  --approve, --request-changes, --comment, --body <text> or --body-file <path>
flags{comment}:
  --body <text> or --body-file <path> (required)
flags{checks}:
  (none)
flags{diff}:
  --full (show complete diff without truncation)
examples:
  gh-axi pr list --state open --label bug
  gh-axi pr view 42 --comments
  gh-axi pr view 42 --reviews
  gh-axi pr comment 42 --body-file review.md
  gh-axi pr merge 42 --squash --delete-branch
```

## Appendix: Label Help Text

```
usage: gh-axi label <subcommand> [flags]
subcommands[4]:
  list, create, edit <name>, delete <name>
flags{list}:
  --limit <n> (default 500)
flags{create}:
  --name <text> (required), --color <hex> (required, without #), --description <text>
flags{edit}:
  --name, --color, --description
examples:
  gh-axi label list
  gh-axi label create --name "priority:high" --color ff0000 --description "High priority"
  gh-axi label delete "priority:low"
```

## Appendix: Subissue Help Text

```
usage: gh-axi issue subissue <add|remove|list> <parent> [child...]
subcommands[3]:
  add <parent> <child> [<child> ...], remove <parent> <child>, list <parent>
examples:
  gh-axi issue subissue add 16 20 101 125
  gh-axi issue subissue remove 16 101
  gh-axi issue subissue list 16
```
