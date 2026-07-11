# Use `axi-sdk-js` as the CLI framework

gitea-axi is built on the `axi-sdk-js` npm package, matching gh-axi's architecture.

## What this provides

- `runAxiCli` — CLI runner handling `--help`, `--version`, home dispatch, error catch → stdout, and `process.exitCode`
- `AxiError` / `exitCodeForError` — typed error class and exit code mapping
- `renderOutput` / `renderError` / `homeHeaderOutput` — TOON output helpers
- Home-view `bin:` + `description:` header (AXI Principle 8)

## Considered Options

**Reimplement locally** — Duplicates the CLI runner, error routing, and output helpers without benefit.
Likely to drift from the AXI standard over time.

**Use `axi-sdk-js`** (chosen) — Correct error routing (stdout, not stderr), consistent exit codes, and `--help`/`--version` handled for free.
Keeps gitea-axi aligned with the evolving AXI ecosystem without owning that surface.

## Consequences

Error output goes to stdout (not stderr), matching gh-axi and axi-sdk-js behaviour.
The home/dashboard view automatically gets a `bin:` + `description:` header (AXI Principle 8).
`VALIDATION_ERROR` exits with code 2; all other errors exit with code 1.
