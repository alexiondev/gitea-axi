# gh-axi Source Reference

This document is the definitive reference for what gh-axi actually does, derived
by reading every source file in the
[kunchenguid/gh-axi](https://github.com/kunchenguid/gh-axi) repository.
It is the ground truth for validating gitea-axi implementation decisions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Framework: axi-sdk-js and runAxiCli](#framework-axi-sdk-js-and-runaxicli)
3. [Core Infrastructure](#core-infrastructure)
   - [gh.ts — Subprocess Layer](#ghts--subprocess-layer)
   - [context.ts — Repository Resolution](#contextts--repository-resolution)
   - [host.ts — Hostname Resolution](#hostts--hostname-resolution)
   - [args.ts — Argument Parsing](#argsts--argument-parsing)
   - [body.ts — Body Input Handling](#bodyts--body-input-handling)
   - [toon.ts — Output Rendering and FieldDef Type System](#toonts--output-rendering-and-fielddef-type-system)
   - [fields.ts — --fields Flag Parsing](#fieldsts----fields-flag-parsing)
   - [format.ts — Count Line Formatting](#formatts--count-line-formatting)
   - [errors.ts — Error Classification](#errorsts--error-classification)
   - [suggestions.ts — Suggestion Normalization](#suggestionsts--suggestion-normalization)
4. [cli.ts — Top-Level Dispatcher](#clits--top-level-dispatcher)
5. [Commands](#commands)
   - [home](#home-command)
   - [issue](#issue-command)
   - [pr](#pr-command)
   - [label](#label-command)
   - [run](#run-command-skimmed)
6. [Cross-Cutting Patterns](#cross-cutting-patterns)

---

## Architecture Overview

gh-axi is a thin ergonomic wrapper around the `gh` CLI.
Its job is to:

1. Accept structured arguments from an AI agent.
2. Delegate the actual GitHub API work to `gh` subprocess calls.
3. Format the results in TOON (a machine-readable structured text format) so
   the agent can parse them efficiently.

Every command function has the signature:

```ts
async function someCommand(args: string[], ctx?: RepoContext): Promise<string>
```

The return value is always a TOON-encoded string.
Errors are thrown as `AxiError` instances; the framework catches them and
renders them in TOON format before returning to the caller.

gh-axi never calls the GitHub API directly — all API access goes through `gh`
subprocess invocations.
The one exception is REST API calls that go through `gh api <path>`, which is
still a `gh` subprocess.

---

## Framework: axi-sdk-js and runAxiCli

`cli.ts` calls `runAxiCli()` from the `axi-sdk-js` package.
That function owns:

- Parsing `-v`/`-V`/`--version` and `--help`.
- Dispatching to the correct command handler based on `argv[0]`.
- Calling `resolveContext()` to build the `RepoContext` before any command runs.
- Catching `AxiError` and rendering it as a TOON error block.
- Writing the result string to stdout.

The `AxiError` class is imported from `axi-sdk-js` and re-exported from
`errors.ts`.
Its constructor signature is:

```ts
new AxiError(message: string, code: ErrorCode, suggestions?: string[])
```

`exitCodeForError(err)` — also from `axi-sdk-js` — maps an `AxiError` code to
a POSIX exit code (used by the framework, not directly by command handlers).

---

## Core Infrastructure

### gh.ts — Subprocess Layer

All `gh` subprocess calls route through four functions.

**`ghJson<T>(args, ctx?)`**
Runs `gh <args>`, appends `--repo owner/name` when `ctx.source !== 'git'`,
parses stdout as JSON, and returns `T`.
Throws `AxiError` on non-zero exit (via `mapGhError`) or JSON parse failure.

**`ghExec(args, ctx?)`**
Same as `ghJson` but returns raw stdout string.
Used for commands that emit URLs or human-readable output rather than JSON.

**`ghRaw(args, ctx?)`**
Same invocation as `ghExec` but returns `{ stdout, stderr, exitCode }` without
throwing on non-zero exit.
Used when the caller needs to inspect the exit code (e.g., `pr revert` fallback
path, `pr list` GraphQL totalCount).

**`ghExecWithStdin(args, input, ctx?)`**
Writes `input` to the child's stdin instead of passing it as a CLI flag.
Used for secrets and variables so sensitive values never appear in argv.

**Repo injection rule:** `--repo owner/name` is appended automatically for
`ctx.source === 'flag'` or `ctx.source === 'env'`.
When `ctx.source === 'git'` (resolved from the local git remote), the flag is
omitted and `gh` auto-detects the repo.

**Buffer limit:** 10 MB (`MAX_BUFFER_BYTES`).

**ENOENT handling:** If `gh` is not installed, the `execFile` call produces an
`ENOENT` error, which is converted to a `GH_NOT_INSTALLED` `AxiError` with the
message `"gh CLI is not installed — see https://cli.github.com"`.

---

### context.ts — Repository Resolution

`resolveRepo(flagValue?)` resolves the target repository.
Priority order:

1. Explicit `--repo` / `-R` flag value passed in `flagValue`.
2. `GH_REPO` environment variable.
3. `git remote get-url origin` (parsed for both SSH and HTTPS URL forms).

Returns `RepoContext | undefined`.

```ts
interface RepoContext {
  owner: string;
  name: string;
  nwo: string;        // "OWNER/NAME"
  source: "flag" | "env" | "git";
  host?: HostContext;
}
```

The `source` field controls whether `--repo` is appended to `gh` calls (see
gh.ts above).

URL parsing supports:
- SSH: `git@<host>:OWNER/NAME.git`
- HTTPS: `https://<host>/OWNER/NAME.git`
- The host matched against is the configured GH_HOST (defaults to `github.com`).

---

### host.ts — Hostname Resolution

`resolveHost(flagValue?)` resolves the effective GitHub hostname.
Priority: explicit `--hostname` flag > `GH_HOST` env > `"github.com"`.

When `--hostname` is provided, `cli.ts` writes it into `process.env["GH_HOST"]`
before running any command.
This means the child `gh` process inherits the hostname via env, and
`resolveRepo()`'s URL parser also sees the correct host via `resolveHost()`.

`DEFAULT_HOST = "github.com"`.

`HostContext`:
```ts
interface HostContext {
  value: string;
  source: "flag" | "env" | "default";
}
```

---

### args.ts — Argument Parsing

All argument parsing is done by hand — no external argument parser library.

Key functions:

**`getFlag(args, name)`** — read a flag's value without modifying `args`.
Supports `--flag value` and `--flag=value` forms.

**`takeFlag(args, flag)`** — read and remove a flag (and its value) from `args`.

**`hasFlag(args, flag)`** — boolean presence check, does not modify `args`.

**`takeBoolFlag(args, flag)`** — check presence and remove from `args`.

**`getAllFlags(args, flag)`** — collect all values for a repeatable flag
(e.g., multiple `--label` flags).

**`getPositional(args, startIndex)`** — return the first non-flag arg starting
from `startIndex`.

**`requireNumber(raw, label)`** — parse a string as an integer, throw
`VALIDATION_ERROR` if missing or not numeric.

**`takeNumber(args, label)`** — find the first all-digit positional in `args`,
remove it, and return it as a number.
Used by most `pr` subcommands to extract the PR number even when it appears
anywhere in the argument list.

---

### body.ts — Body Input Handling

Handles `--body` (inline text) and `--body-file` (file path) flags for all
commands that accept a body.

**`takeBody(args, options?)`**
Removes the matched flag(s) from `args` and returns the body string.

- `options.required: true` — throws `VALIDATION_ERROR` if no body source is
  provided.
- `options.inlineFlags` — defaults to `["--body"]`.
- `options.fileFlags` — defaults to `["--body-file"]`.
- `options.valueBoundaryFlags` — additional flags that signal the end of a
  value (prevents consuming the next flag as the value).
- `options.label` — used in error messages (defaults to `"body"`).

Conflict rule: only one body source is allowed; providing both `--body` and
`--body-file` throws `VALIDATION_ERROR`.

File reading: Uses synchronous `readFileSync` with UTF-8 encoding.
Throws `VALIDATION_ERROR` with the appropriate message for `ENOENT` (file not
found) and `EISDIR` (path is a directory).

**`cleanBody(text)`**
Applied before truncation to reduce token cost.
Transformations applied in order:

1. Normalize GitHub PR/issue URLs in markdown links to `PR#N` / `Issue#N`.
2. Normalize bare GitHub PR/issue URLs to `PR#N` / `Issue#N`.
3. Strip markdown image embeds `![alt](url)` → `[image: alt]` or `[image]`.
4. Strip long URLs (>80 chars) in markdown links: `[text](longurl)` → `[text]`.
5. Strip standalone long URLs (>100 chars) not in markdown → `[long URL removed]`.
6. Collapse email-style quoted blocks (3+ consecutive `> ...` lines) →
   `[quoted text removed]`.

**`truncateBody(body, maxLen=500, options?)`**
Returns the body for display.

- If `body.length <= maxLen`: returns body as-is (no cleaning applied).
- If cleaned body fits within `maxLen`: returns the cleaned body.
  If cleaning changed the content, appends
  `"\n(cleaned, N chars original - use --full to see original)"`.
- If cleaned body still exceeds `maxLen`: returns first `maxLen` chars of the
  cleaned body plus
  `"\n... (truncated, N chars total - use --full to see complete body)"`.

Key invariant: **cleaning is only applied when truncation is needed**.
The raw body is preserved when it fits.

`--full` flag bypasses truncation entirely at the command level by swapping
`viewSchema` for `viewSchemaFull` (which uses the raw body directly).

---

### toon.ts — Output Rendering and FieldDef Type System

TOON is the structured text format used for all gh-axi output.
The actual encoding is delegated to `@toon-format/toon`'s `encode()` function.

#### FieldDef Type System

`FieldDef` is a discriminated union describing how to extract and format one
field from a raw JSON item.

```ts
type FieldDef =
  | { type: 'field'; key: string; as?: string }
  | { type: 'pluck'; key: string; subkey: string; as?: string }
  | { type: 'joinArray'; key: string; subkey: string; as?: string; empty?: string }
  | { type: 'relativeTime'; key: string; as?: string }
  | { type: 'boolYesNo'; key: string; as?: string }
  | { type: 'mapEnum'; key: string; map: Record<string,string>; fallback?: string; as?: string }
  | { type: 'lower'; key: string; as?: string }
  | { type: 'checksSummary'; key: string; as?: string }
  | { type: 'custom'; as: string; fn: (item: any) => any }
```

Constructor helpers (all exported from `toon.ts`):

| Helper | What it produces |
|--------|-----------------|
| `field(key, as?)` | Raw value from `item[key]`, null if missing |
| `pluck(key, subkey, as?)` | `item[key][subkey]`, null if missing |
| `joinArray(key, subkey, as?, empty?)` | Comma-joined array of `item[key][n][subkey]` or raw strings; `empty` defaults to `"none"` |
| `relativeTime(key, as?)` | ISO date → human string: "just now", "Nm ago", "Nh ago", "Nd ago", "Nmo ago", "Ny ago" |
| `boolYesNo(key, as?)` | boolean → `"yes"` / `"no"` |
| `mapEnum(key, map, fallback?, as?)` | Maps enum string through `map`; uses `fallback` or raw value if not in map |
| `lower(key, as?)` | `.toLowerCase()` on a string value |
| `checksSummary(key, as?)` | Array of check runs → `"N/M pass"` |
| `custom(as, fn)` | Arbitrary extractor; `fn` receives the full raw item |

The `as` parameter overrides the output key name (defaults to `key` for all
non-custom types).

#### Rendering Functions

**`extract(item, schema)`** — applies a `FieldDef[]` schema to one raw item,
returning a flat `Record<string, unknown>`.

**`renderList(label, items, schema)`** — encodes `{ [label]: extractedItems[] }`
as TOON.

**`renderDetail(label, item, schema)`** — encodes `{ [label]: extractedItem }`
as TOON.

**`renderHelp(lines)`** — renders a help section.
Format: `help[N]:\n  line1\n  line2\n...`
(Manual formatting — not using `encode()` because that inlines primitive
arrays.)

**`renderError(message, code, suggestions?)`** — encodes
`{ error: message, code }` as TOON, followed by a `renderHelp(suggestions)`
block if suggestions are provided.

**`renderOutput(blocks)`** — joins non-empty blocks with `"\n"`.

---

### fields.ts — --fields Flag Parsing

`parseFields(fieldsArg, available)` processes the value of `--fields`.

- `fieldsArg` undefined → returns `{ extraDefs: [], extraJsonKeys: [] }` (no-op).
- Splits the value on commas, deduplicates (using `Set`), trims whitespace.
- Validates against `available: Record<string, ExtraFieldSpec>`.
  Unknown fields throw `VALIDATION_ERROR` listing all available names.
- Returns:
  - `extraDefs: FieldDef[]` — additional FieldDef entries to append to the base
    schema.
  - `extraJsonKeys: string[]` — additional JSON field keys to pass to `gh --json`.

`ExtraFieldSpec`:
```ts
interface ExtraFieldSpec {
  jsonKey: string;   // the gh JSON field name to add to --json
  def: FieldDef;     // the FieldDef to render it
}
```

The caller merges `extraJsonKeys` into the base JSON fields string and appends
`extraDefs` to the base schema before rendering.

---

### format.ts — Count Line Formatting

`formatCountLine(opts)` produces a single count line for list commands.

Logic (checked in order):

1. `apiLimitHit: true` → `"count: N+ (GitHub search API limit reached)"`
2. `totalCount` defined → `"count: N of T total"`
3. `displayLimit` defined and `count > displayLimit` →
   `"count: N (showing first D)"`
4. `limit` defined and `count === limit && count > 0` →
   `"count: N (showing first N)"`
5. Otherwise → `"count: N"`

---

### errors.ts — Error Classification

Re-exports `AxiError` and `exitCodeForError` from `axi-sdk-js`.

Defines `ErrorCode`:
```ts
type ErrorCode =
  | "REPO_NOT_FOUND" | "NOT_FOUND" | "AUTH_REQUIRED" | "FORBIDDEN"
  | "VALIDATION_ERROR" | "RATE_LIMITED" | "GH_NOT_INSTALLED" | "UNKNOWN"
```

`mapGhError(stderr, exitCode)` — classifies stderr text from a failed `gh`
invocation into one of the above codes.
Patterns matched (in order):

| Pattern | Code | Message |
|---------|------|---------|
| `Could not resolve to a Repository with the name 'X'` | `REPO_NOT_FOUND` | `Repository "X" not found` |
| `Could not resolve to an? .+? with the number of N` | `NOT_FOUND` | `Item #N does not exist` |
| `issue N not found` | `NOT_FOUND` | `Issue #N does not exist` |
| `pull request N not found` | `NOT_FOUND` | `Pull request #N does not exist` |
| `release with tag "X" not found` | `NOT_FOUND` | `Release "X" not found` |
| `run N not found` | `NOT_FOUND` | `Run N not found` |
| `gh auth login` | `AUTH_REQUIRED` | auth prompt message |
| `authentication token is missing required scopes [X]` | `FORBIDDEN` | missing scopes message |
| `secondary rate limit` | `RATE_LIMITED` | rate limit message |
| `API rate limit exceeded` | `RATE_LIMITED` | rate limit message |
| `sub-issue is already a sub-issue of issue with number N` | `VALIDATION_ERROR` | already sub-issue message |
| `sub-issue cycle/circular` | `VALIDATION_ERROR` | cycle message |
| `issue cannot be a sub-issue of itself` | `VALIDATION_ERROR` | self message |
| `HTTP 403` | `FORBIDDEN` | permissions message |
| `HTTP 422` | `VALIDATION_ERROR` | message from response body if available |
| `not found` (generic) | `NOT_FOUND` | first stderr line |
| fallback | `UNKNOWN` | first stderr line or `"gh exited with code N"` |

`ghNotInstalledError()` — returns `AxiError("gh CLI is not installed...", "GH_NOT_INSTALLED")`.

---

### suggestions.ts — Suggestion Normalization

`getSuggestions(ctx)` returns a list of hint strings for the `help[N]:` block
that follows most command output.

`SuggestionContext`:
```ts
interface SuggestionContext {
  domain: string;        // "issue", "pr", "run", "label", "home", ...
  action: string;        // "list", "view", "create", ...
  state?: string;        // "open", "closed", "merged", "in_progress", ...
  isEmpty?: boolean;     // for list commands
  id?: string | number;  // entity number/id/tag for template substitution
  repo?: RepoContext;
  host?: HostContext;
  owner?: string;        // for project commands
}
```

The table is matched top-to-bottom; the first matching entry wins.

**-R flag injection rule:**
`repoFlag(ctx)` returns `" -R owner/name"` when `ctx.repo.source !== "git"`.
When `source === "git"`, the empty string is returned (no `-R` in suggestions).
This means suggestion strings automatically include `-R` when the repo was
specified via flag or env, but omit it when detected from the git remote.

**-R flag position normalization:**
After generating suggestion lines, each line is passed through
`normalizeRepoFlagLine()`, which rewrites any
`` `gh-axi -R X/Y subcommand args` `` into
`` `gh-axi subcommand args -R X/Y` ``.
This enforces the convention that `-R` comes after the subcommand.

**--hostname flag injection:**
After normalizing `-R`, `appendHostnameFlag()` appends ` --hostname HOST` to
every backtick-quoted `gh-axi ...` invocation in the line — but only when the
host was set via `--hostname` flag (not via `GH_HOST` env or default).

`withSuggestionHost(host, callback)` — sets a thread-local active host so that
`getSuggestions()` can read the hostname context even when it is not included in
the `SuggestionContext` arg.
Called by `withRepoContext()` in `cli.ts` to propagate the resolved
`HostContext` into every command handler's suggestion calls.

---

## cli.ts — Top-Level Dispatcher

Registers 14 commands: `issue`, `pr`, `run`, `workflow`, `release`, `repo`,
`label`, `project`, `secret`, `variable`, `search`, `api`, `setup`.
The no-arg case (home dashboard) is handled by `homeCommand`.

**Global flags** (stripped before dispatch):
- `-R <nwo>` or `-R=<nwo>` — repo override.
- `--repo <nwo>` or `--repo=<nwo>` — repo override.
  Exception: for the `search` command, `--repo` is passed through to `gh search`
  rather than being stripped.
- `--hostname <host>` or `--hostname=<host>` — host override, written to
  `process.env["GH_HOST"]` so it propagates to child `gh` processes.
- `--help`, `-v`, `-V`, `--version` — handled by `runAxiCli`.

`parseRepoContextArgs(command, args)` strips the repo/host flags and returns:
- `repoFlag` — the repo NWO string (or undefined).
- `hostFlag` — the hostname string (or undefined).
- `strippedArgs` — remaining args passed to the command handler.

`withRepoContext(command, handler)` wraps each command handler:
1. Calls `parseRepoContextArgs` to strip repo/host flags from args.
2. Extracts the `RepoContext` from the resolved CLI context.
3. Calls `withSuggestionHost` to set the host for suggestion rendering.
4. Calls the underlying handler with stripped args and repo context.

---

## Commands

### home Command

**File:** `src/commands/home.ts`

**What it does:**
Dashboard view.
Runs two `gh` calls in parallel:
- `gh issue list --json number,title,state,author --limit 3`
- `gh pr list --json number,title,author,reviewDecision --limit 3`

If either call fails, it silently returns an empty array (`.catch(() => [])`).

**Delegation:** Fully delegates to `gh` subprocess.

**Output:**
```
repo: owner/name          ← only when ctx is defined
issues: [ { number, title, state, author }, ... ]
prs: [ { number, title, author, review }, ... ]
help[N]:
  Run `gh-axi issue list` for full issue list   ← only if issues >= 3
  Run `gh-axi pr list` for full PR list         ← only if prs >= 3
  Run `gh-axi <command> <subcommand>` ...       ← from suggestions table
```

**Idempotency:** Read-only; not applicable.

**Truncation:** None (only 3 items shown per entity type; no body fields).

---

### issue Command

**File:** `src/commands/issue.ts`

**Subcommands:** list, view, create, edit, close, reopen, comment, delete, lock,
unlock, pin, unpin, transfer, subissue (add/remove/list)

---

#### issue list

**Delegation:** `gh issue list --json --limit` with optional filters.

**Flags:**
- `--state <open|closed|all>` (default: unset, gh defaults to `open`)
- `--label <name>`
- `--assignee <login>`
- `--author <login>`
- `--milestone <name>`
- `--sort <created|updated|comments>` — translated to `--search sort:X-desc`
  passed to `gh`
- `--limit <n>` (default 30)
- `--fields <a,b,c>` — extra fields (see below)
- `--search` — **explicitly forbidden**; throws `VALIDATION_ERROR` redirecting
  to `gh-axi search issues`

**Default JSON fields:** `number,title,state,author,createdAt`

**Extra fields available via --fields:**

| Name | JSON key | Output key |
|------|----------|------------|
| `body` | `body` | `body` (raw, not truncated) |
| `closedAt` | `closedAt` | `closed_at` (relative time) |
| `labels` | `labels` | `labels` (comma-joined names) |
| `milestone` | `milestone` | `milestone` (title) |
| `updatedAt` | `updatedAt` | `updated_at` (relative time) |
| `url` | `url` | `url` |

**Default output schema (list):**

| Output key | Source | Transform |
|------------|--------|-----------|
| `number` | `number` | raw |
| `title` | `title` | raw |
| `state` | `state` | lowercase |
| `author` | `author.login` | pluck |
| `created` | `createdAt` | relative time |

**True-count behavior:**
If `items.length === limit` and `ctx` is defined, gh-axi makes a secondary
GraphQL call to get the real `totalCount`:
```graphql
{ repository(owner:"...", name:"...") { issues(states:[STATE]) { totalCount } } }
```
On success, the count line becomes `"count: N of T total"`.
On failure, falls back to `"count: N (showing first N)"`.

**Error handling:** `--search` is a hard `VALIDATION_ERROR` before any `gh`
call.

---

#### issue view

**Delegation:** `gh issue view --json` then optional GraphQL for sub-issue
relationships.

**Flags:**
- `<number>` — required positional (uses `requireNumber(getPositional(args, 1))`)
- `--comments` — fetches and renders all comments in a separate block
- `--full` — bypasses body truncation (swaps schema variant)

**JSON fields fetched:**
`number,title,state,author,createdAt,body[,comments],issueType`

`issueType` is attempted first.
If `gh` errors with a message containing `"issueType"`, the field is dropped
and a second call is made without it (`supportsIssueType = false`).

**Default output schema (view):**

| Output key | Source | Transform |
|------------|--------|-----------|
| `number` | `number` | raw |
| `title` | `title` | raw |
| `state` | `state` | lowercase |
| `author` | `author.login` | pluck |
| `created` | `createdAt` | relative time |
| `type` | `issueType.name` | custom (returns `"none"` if absent) |
| `body` | `body` | `truncateBody(body, 500)` |

With `--full`: body field is swapped to return the raw string with no truncation.

With `--comments`: a separate `comments` list block is appended:
```
comments: [ { author, body, created }, ... ]
```
Comments schema filters out the `number` field (it belongs to the issue, not
the comment).

**Sub-issue augmentation (when ctx is defined):**
A best-effort GraphQL call fetches `parent` and `subIssues(first:100)`.
If `childNums.length > 0`, a `subissues: ["#N", ...]` field is added.
If `parentNum != null`, a `parent: "#N"` field is added.
Failures are silently swallowed.

**Body truncation:** 500 chars max (cleaning applied before truncation).

---

#### issue create

**Delegation:** `gh issue create` then `gh issue view` to get structured output.
If `--type` is specified, an additional GraphQL mutation is applied after create.

**Flags:**
- `--title <text>` — required
- `--body <text>` or `--body-file <path>` — optional
- `--assignee <login>`
- `--label <name>` — repeatable
- `--milestone <name>`
- `--project <name>`
- `--type <name>` — issue type (resolved via GraphQL before create)

**Type resolution:** Calls `resolveIssueType(typeName, ctx)` before creating
the issue.
This makes a GraphQL query for `issueTypes(first:25)` and matches
case-insensitively.
On match failure, throws `VALIDATION_ERROR` with the list of available types.

**Output:** `gh issue create` emits a URL; the number is extracted via
regex `/\/issues\/(\d+)/`.
A follow-up `gh issue view N --json number,title,state,url,id` fetches the
structured result.

**Output schema:**
```
issue: { number, title, state, url [, type] }
```

**Idempotency:** None (create is not idempotent).

---

#### issue edit

**Delegation:** `gh issue edit N` then `gh issue view N` for structured output.
If `--type` or `--no-type` is specified, a GraphQL mutation is applied.

**Flags:**
- `<number>` — required positional
- `--title <text>`
- `--body <text>` or `--body-file <path>`
- `--add-label <name>` / `--remove-label <name>`
- `--add-assignee <login>` / `--remove-assignee <login>`
- `--milestone <name>`
- `--type <name>` — set issue type (resolved via GraphQL)
- `--no-type` — clear issue type (sends `issueTypeId: null` via GraphQL)

**Important:** `gh issue edit` is only called when there is at least one
non-type field to update (i.e., `ghArgs.length > 3`).
If only `--type` or `--no-type` is given, the edit call is skipped and only
the GraphQL mutation runs.

**Output schema:**
```
issue: { number, title, state, labels, assignees [, type] }
```

---

#### issue close

**Delegation:** `gh issue view` (idempotency check) then `gh issue close`.

**Flags:**
- `<number>` — required positional
- `--reason <completed|not_planned>`
- `--comment <text>`

**Idempotency:** Checks current state first.
If already `"closed"`, returns the issue detail with `message: "Already closed"`
without calling `gh issue close`.

**Output schema (success):** `issue: { number, state }`

---

#### issue reopen

**Delegation:** `gh issue view` (idempotency check) then `gh issue reopen`.

**Idempotency:** Checks current state.
If already `"open"`, returns `message: "Already open"`.

**Output schema:** `issue: { number, state }`

---

#### issue comment

**Delegation:** `gh issue comment N --body <body>` then `gh issue view N
--json comments` to get the last comment for structured output.

**Flags:**
- `<number>` — required positional
- `--body <text>` or `--body-file <path>` — **required** (`takeBody(args, { required: true })`)

**Body truncation:** The comment body in the output is truncated to 800 chars
(larger than issue body's 500 chars).

**Output schema:** `comment: { issue, author, created, body }`

---

#### issue delete

**Delegation:** `gh issue delete N --yes`

**Flags:** `<number>` — required positional.

**Idempotency:** None (will error if issue does not exist; error is mapped by
`mapGhError`).

**Output schema:** `issue: { number, status: "deleted" }`

---

#### issue lock / unlock

**Delegation:** `gh issue view` (idempotency check) then `gh issue lock/unlock N`.

**Idempotency:**
- `lock`: returns early with `message: "Already locked"` if `current.locked === true`.
- `unlock`: returns early with `message: "Already unlocked"` if `current.locked === false`.

**Output schema:** `issue: { number, state, locked }`

---

#### issue pin / unpin

**Delegation:** `gh issue view` (idempotency check) then `gh issue pin/unpin N`.

**Idempotency:**
- `pin`: returns early with `message: "Already pinned"` if `current.isPinned === true`.
- `unpin`: returns early with `message: "Already unpinned"` if `current.isPinned === false`.

**Output schema:** `issue: { number, state, pinned }`

---

#### issue transfer

**Delegation:** `gh issue transfer N destRepo` then attempts `gh issue view N
--json number,url --repo destRepo` to get the new URL.

**Flags:**
- `<number>` — required positional
- `--to-repo <owner/name>` — **required**

**Fallback:** If the post-transfer view fails, constructs a best-effort URL from
`https://resolveHost()/destRepo/issues/N`.

**Output schema:** `issue: { number, url }`

---

#### issue subissue

Three-layer dispatch: `issue subissue <add|remove|list>`.
All subissue operations require `ctx` (will throw `VALIDATION_ERROR` if no
repo can be determined).
All use GraphQL directly (not `gh issue` subcommands) because GitHub does not
expose sub-issues via the `gh` REST CLI.

**subissue add `<parent> <child> [<child> ...]`**

1. Batch-resolves all node IDs via one GraphQL query.
2. Adds each child sequentially via `addSubIssue` mutation.
3. On partial failure, throws with a message listing already-added children.

Output schema: `subissue_add: { parent: "#N", added: ["#N", ...] }`

**subissue remove `<parent> <child>`**

Resolves node IDs then calls `removeSubIssue` mutation.

Output schema: `subissue_remove: { parent: "#N", removed: "#N" }`

**subissue list `<parent>`**

GraphQL query for `subIssues(first:100)`.
Limit is hard-coded at 100; `formatCountLine` is called with `totalCount` from
GraphQL so the output shows `"count: N of T total"` when there are more than 100.

Output:
```
parent: #N
count: N [of T total]
subissues: [ { number, title, state }, ... ]
```

---

### pr Command

**File:** `src/commands/pr.ts`

**Subcommands:** list, view, create, edit, close, merge, review, checks, diff,
checkout, ready, reopen, comment, update-branch, revert

---

#### pr list

**Delegation:** `gh pr list --json --state --limit` with optional filters.

**Flags:**
- `--state <open|closed|all>` (default `"open"`, consumed by `takeFlag`)
- `--label <name>`
- `--assignee <login>`
- `--author <login>`
- `--base <branch>`
- `--head <branch>`
- `--draft` — boolean flag
- `--limit <n>` (default 30)
- `--fields <a,b,c>`
- `--search` — **explicitly forbidden**, throws `VALIDATION_ERROR`

**Default JSON fields:** `number,title,state,author,isDraft,reviewDecision`

**Extra fields via --fields:**

| Name | JSON key | Output key |
|------|----------|------------|
| `body` | `body` | `body` (raw) |
| `createdAt` | `createdAt` | `created` (relative time) |
| `labels` | `labels` | `labels` (comma-joined names) |
| `milestone` | `milestone` | `milestone` (title) |
| `mergedAt` | `mergedAt` | `merged_at` (relative time) |
| `url` | `url` | `url` |

**Default output schema (list):**

| Output key | Source | Transform |
|------------|--------|-----------|
| `number` | `number` | raw |
| `title` | `title` | raw |
| `state` | `state` | lowercase |
| `author` | `author.login` | pluck |
| `draft` | `isDraft` | bool→yes/no |
| `review` | `reviewDecision` | mapEnum: APPROVED→approved, CHANGES\_REQUESTED→changes\_requested, REVIEW\_REQUIRED→required; fallback "none" |

**True-count behavior:** Same pattern as issue list — secondary GraphQL when
`items.length === limit` and `ctx` is defined.
GraphQL query:
```graphql
{ repository(owner:"...", name:"...") { pullRequests(states:[STATE]) { totalCount } } }
```
State mapping: `ALL` → no `states:[]` filter; `CLOSED` → `states:[CLOSED,MERGED]`;
otherwise `states:[STATE]`.

---

#### pr view

**Delegation:** `gh pr view N --json` then optional REST API calls for reviews.

**Flags:**
- `<number>` — required (via `takeNumber`)
- `--comments` — includes full comment content
- `--reviews` — fetches reviews and inline review comments via REST API
- `--full` — bypasses body truncation

**JSON fields always fetched:**
`number,title,state,author,isDraft,mergedAt,statusCheckRollup,body,comments,reviews`

**Default output schema (view):**

| Output key | Source | Transform |
|------------|--------|-----------|
| `number` | `number` | raw |
| `title` | `title` | raw |
| `state` | `state` | lowercase |
| `author` | `author.login` | pluck |
| `draft` | `isDraft` | bool→yes/no |
| `merged` | custom | `mergedAt` value if state is MERGED, else `"no"` |
| `checks` | custom | classifies `statusCheckRollup`: "N passed, N failed[, N skipped], N total" or "0 passed, 0 failed — this PR has no CI checks configured" |
| `body` | custom | `truncateBody(body, 500)` |

With `--full`: body field returns raw string.

**comment_count vs comments:**
Without `--comments`: `comment_count: "N — use --comments to see full comments"`.
With `--comments`: `comments: [ { author, body, created }, ... ]` appended to schema.

**review_count vs reviews:**
Without `--reviews`: `review_count: "N — use --reviews to see full reviews"`.
With `--reviews`: two REST API calls:
1. `gh api repos/{owner}/{repo}/pulls/N/reviews --paginate --slurp`
2. `gh api repos/{owner}/{repo}/pulls/N/comments --paginate --slurp`
   (only if reviews exist)

Reviews are correlated with inline comments by `pull_request_review_id`.
Output: `reviews: [ { author, state, submitted, body, inline_comments: [...] } ]`

Review states mapped via `REVIEW_STATE_MAP`:
APPROVED→approved, CHANGES\_REQUESTED→changes\_requested,
COMMENTED→commented, DISMISSED→dismissed, PENDING→pending.

**CI check classification:**
```
"pass":    conclusion === SUCCESS or NEUTRAL
"fail":    conclusion === FAILURE, TIMED_OUT, or ACTION_REQUIRED
"skip":    conclusion === SKIPPED or CANCELLED; or state === EXPECTED or NEUTRAL
"pending": everything else
```

**Body truncation:** 500 chars (same as issue view).

---

#### pr create

**Delegation:** `gh pr create` then parses stdout URL.

**Flags:**
- `--title <text>` — **required**
- `--body <text>` or `--body-file <path>` — optional
- `--base <branch>`
- `--head <branch>`
- `--draft`
- `--assignee <login>`
- `--reviewer <login>`
- `--label <name>` — repeatable (via `getAllFlags`)
- `--milestone <name>`
- `--project <name>`

**Number extraction:** Regex `/\/pull\/(\d+)/` on stdout.

**Output schema:** `created: { number, url }`

---

#### pr edit

**Delegation:** `gh pr edit N` (no post-fetch; returns minimal success object).

**Flags:**
- `<number>` — required (via `takeNumber`)
- `--title <text>`
- `--body <text>` or `--body-file <path>`
- `--add-label <name>` / `--remove-label <name>`
- `--add-assignee <login>` / `--remove-assignee <login>`
- `--add-reviewer <login>` / `--remove-reviewer <login>`
- `--milestone <name>`
- `--base <branch>`

**Output schema:** `edited: { number, status: "ok" }`

---

#### pr close

**Delegation:** `gh pr view` (idempotency check) then `gh pr close N`.

**Flags:**
- `<number>` — required
- `--comment <text>`

**Idempotency:** If state is already `"CLOSED"` or `"MERGED"`, returns early
with `pull_request: { number, state, already: true }`.

**Output schema (success):** `closed: { number, status: "ok" }`

---

#### pr merge

**Delegation:** `gh pr view` (idempotency check) then `gh pr merge N`.

**Flags:**
- `<number>` — required
- `--method <merge|squash|rebase>`
- `--merge`, `--squash`, `--rebase` — shorthands (mutually exclusive with
  each other and with `--method` unless they agree)
- `--auto`
- `--delete-branch`
- `--body <text>` or `--body-file <path>`
- `--subject <text>`

**Method validation:**
Two or more shorthand flags → `VALIDATION_ERROR`.
`--method` and a non-matching shorthand → `VALIDATION_ERROR`.
Invalid `--method` value → `VALIDATION_ERROR`.

**Idempotency:** If already MERGED, returns:
`pull_request: { number, state: "merged", merged_by, merged_at }`

**Output schema (success):** `merged: { number, status: "ok", method }`
`method` is the resolved method string or `"default"` if none specified.

---

#### pr review

**Delegation:** `gh pr review N [--approve|--request-changes|--comment]`.

**Flags:**
- `<number>` — required
- `--approve`
- `--request-changes`
- `--comment`
- `--body <text>` or `--body-file <path>` — optional

**Output schema:** `review: { number, action }` where action is one of
`"approved"`, `"changes_requested"`, `"commented"`.

---

#### pr checks

**Delegation:** `gh pr view N --json statusCheckRollup`
(avoids `gh pr checks --json` which can error on unusual check data).

**Flags:** `<number>` — required.

**Output:**
```
summary: "N passed, N failed[, N skipped][, N pending], N total"
checks: [ { name, conclusion }, ... ]
help[N]: ...
```

When no checks configured:
```
checks: "0 passed, 0 failed — this PR has no CI checks configured"
```

Check name: uses `c.name ?? c.context ?? "check"`.
Check conclusion: classified to `"pass"`, `"fail"`, `"skip"`, or `"pending"`.

---

#### pr diff

**Delegation:** `gh pr diff N` (raw text output).

**Flags:**
- `<number>` — required
- `--full` — bypass truncation

**Truncation limit:** 4000 chars (hard-coded `DIFF_TRUNCATE_LIMIT`).
Truncates from the beginning (keeps the first 4000 chars of the diff, unlike
log truncation which keeps the tail).

When truncated, output includes `truncated: true` and `original_length: N`.
When `--full` is not passed and the diff is truncated, prepends a suggestion:
`` "Run `gh-axi [-R nwo] pr diff N --full` to see the complete diff" ``.

**Output schema:** `pr_diff: { number, diff[, truncated, original_length] }`

---

#### pr checkout

**Delegation:** `gh pr checkout N`.

**Flags:** `<number>` — required.

Branch name extracted via `/Switched to branch '([^']+)'/` on stdout;
falls back to `stdout.trim()`.

**Output schema:** `checkout: { number, branch, status: "ok" }`

---

#### pr ready

**Delegation:** `gh pr view` (idempotency check) then `gh pr ready N`.

**Idempotency:** If `isDraft === false`, returns early:
`pull_request: { number, draft: "no", already: true }`.

**Output schema (success):** `ready: { number, status: "ok" }`

---

#### pr reopen

**Delegation:** `gh pr view` (idempotency check) then `gh pr reopen N`.

**Idempotency:** If state is `"OPEN"`, returns early:
`pull_request: { number, state: "open", already: true }`.

**Output schema (success):** `reopened: { number, status: "ok" }`

---

#### pr comment

**Delegation:** `gh pr comment N --body <body>`.

**Flags:**
- `<number>` — required
- `--body <text>` or `--body-file <path>` — **required**

**Output schema:** `commented: { number, status: "ok" }`

---

#### pr update-branch

**Delegation:** `gh pr update-branch N`.

**Flags:** `<number>` — required.

**Output schema:** `updated: { number, status: "ok" }`

---

#### pr revert

**Delegation:** Tries `gh pr revert N` first (may not exist in all gh versions).

If exit code is non-zero, falls back to:
`gh api repos/{owner}/{repo}/pulls/N/revert --method POST`

On failure of both, throws `UNKNOWN` `AxiError` with the first stderr line.

The revert PR number is extracted from stdout via `/\/pull\/(\d+)/`.

**Output schema:** `reverted: { number, revert_pr, [url,] status: "ok" }`

---

### label Command

**File:** `src/commands/label.ts`

**Subcommands:** list, create, edit, delete

---

#### label list

**Delegation:** `gh label list --json name --limit N`.

**Flags:** `--limit <n>` (default 500).

**Default output schema:** `labels: [ { name }, ... ]`

**Count line:** uses `formatCountLine({ count, limit })`.

---

#### label create

**Delegation:** Idempotency check via `gh label list --json name`, then
`gh label create`.

**Flags:**
- `--name <text>` — **required**
- `--color <hex>` — **required** (without `#`)
- `--description <text>`

**Idempotency:** Case-insensitive name match.
If found, returns `{ create: "already_exists", label: existingName }` without
creating.

**Output schema (success):** `{ created: "ok", label: name }`

---

#### label edit

**Delegation:** `gh label edit <name>`.

**Flags:**
- `<name>` — positional at args[1]
- `--name <new-name>`
- `--color <hex>`
- `--description <text>`

**Output schema:** `{ edit: "ok", label: newName ?? originalName }`

---

#### label delete

**Delegation:** `gh label delete <name> --yes`.

**Flags:** `<name>` — positional at args[1].

**Output schema:** `{ delete: "ok", label: name }`

---

### run Command (skimmed)

**File:** `src/commands/run.ts`

Not in gitea-axi scope; documented here for the log truncation pattern.

**Log truncation pattern (`wrapLogOutput`):**

Limit: `LOG_TRUNCATE_LIMIT = 20000` chars.

Unlike `pr diff` (which keeps the head), log output truncates to the **tail**:
`output.slice(-LOG_TRUNCATE_LIMIT)`.
Rationale: "CI logs put the failure at the end, so keep the tail when
truncating."

When truncated:
1. Attempts to save the full log to a temp file:
   `mkdtemp` in system tmpdir under `gh-axi-logs-` prefix.
   File name: `{run}[-job-{job}]-{mode}.log` with non-alphanumeric chars
   replaced by `_`.
   File permissions: `0o600`.
2. If saved, `run_log.full_log` is set to the temp file path and a hint is
   added: `"Output shows the last 20000 of N chars; full log saved to PATH -
   grep it for earlier context"`.
3. If save fails (best-effort), a hint without a path is added.

Output schema:
```
run_log: { run, mode, output, truncated, [original_length, full_log] }
```

`run cancel` is idempotent: checks `status === "completed"` before canceling.
If already completed, returns `{ cancel: "already_completed", run, conclusion }`.

---

## Cross-Cutting Patterns

### Idempotency Pattern

Commands that mutate state follow this pattern before calling `gh`:

1. Fetch current state via `gh ... --json state` (or `locked`, `isPinned`, etc.).
2. If already in the target state, return a structured response with
   `already: true` (or `message: "Already X"`).
3. Only then call the mutating `gh` command.

Applies to: `issue close`, `issue reopen`, `issue lock`, `issue unlock`,
`issue pin`, `issue unpin`, `pr close`, `pr merge`, `pr ready`, `pr reopen`,
`run cancel`.

### Body Handling Pattern

Commands that accept body text follow this sequence:

1. Call `takeBody(args, options?)` which removes the flag from `args` and
   returns the body string (or undefined if optional and not provided).
2. If body is not undefined, pass it to `gh` via `--body bodyText`.
3. `takeBody` handles both `--body "text"` and `--body-file path` forms.
4. `--body` and `--body-file` cannot both be provided; `takeBody` throws
   `VALIDATION_ERROR` if both are present.

### Error Propagation Pattern

All `gh` calls that use `ghJson` or `ghExec` throw `AxiError` on failure.
These propagate up through the command handler.
The `runAxiCli` framework catches all `AxiError` instances and renders them as:
```
error: <message>
code: <ERROR_CODE>
help[N]:
  <suggestions>
```

Unhandled errors (non-`AxiError`) are also caught by the framework and rendered
as `UNKNOWN` errors.

### --repo Injection Timing

`-R` / `--repo` is parsed by `parseRepoContextArgs` in `cli.ts` before any
command handler runs.
The flag is stripped from `args` before they are passed to the handler.
The resolved `RepoContext` is passed as the `ctx` parameter.
Inside handlers, `ghJson(args, ctx)` / `ghExec(args, ctx)` call `buildArgs`
which appends `--repo owner/name` when `ctx.source !== 'git'`.

**search command exception:** `--repo` is passed through to the handler (not
stripped) because `gh search` expects `--repo` as its own flag.

### Number Extraction

Most pr subcommands use `takeNumber(args, "PR")` which finds the first
all-digit positional token anywhere in `args` and removes it.
Most issue subcommands use `requireNumber(getPositional(args, 1), "issue")`
which reads position 1 (after the subcommand name) without modifying `args`.

This means issue commands use positional ordering while pr commands are more
permissive (the number can appear anywhere in the remaining args).

### True Count via GraphQL

Both `issue list` and `pr list` make a secondary GraphQL call when the number
of returned items equals the requested limit.
This provides an accurate `"count: N of T total"` line instead of the less
informative `"count: N (showing first N)"`.
The GraphQL call is best-effort: failures silently fall back to the limit-based
message.

### Paginated REST API Calls

`ghApiPaginatedArray<T>(path)` calls `gh api <path> --paginate --slurp` and
flattens the result.
Used by `pr view --reviews` to fetch all review objects and all inline review
comments.

### GraphQL via gh api graphql

Sub-issue operations and issue type resolution bypass `gh issue` subcommands
and call `gh api graphql` directly.
The `gqlRequest` helper passes `void ctx` explicitly (suppressing the lint
warning) because `gh api graphql` ignores `--repo`; the owner/name are baked
into the query string.
