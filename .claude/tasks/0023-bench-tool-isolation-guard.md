---
spec: benchmark-harness
---

## What to build

The guard that keeps each arm's agent confined to exactly one tool, so a benchmark result measures the tool rather than the agent's choice between tools (see the guard-based-tool-isolation ADR).

The guard is a callback that inspects every proposed shell command and permits only the one binary allow-listed for the active arm plus a curated set of harmless utilities, denying everything else. It rejects foreign binaries, absolute-path evasions that sidestep the allow-list, and interpreter-based fetch tricks (reaching the API through a language runtime's HTTP client). A curated per-arm PATH backs the guard as a convenience layer, but the guard — not the PATH — is authoritative. A blocked attempt is surfaced, not silently retried.

## Acceptance criteria

- [x] Each arm's allow-listed binary passes the guard; a foreign binary is denied.
- [x] An absolute-path invocation of a foreign binary is denied.
- [x] An interpreter-based fetch attempt (e.g. driving an HTTP request through a language runtime) is denied.
- [x] A curated per-arm PATH is produced exposing only that arm's allowed binary.
- [x] Unit tests cover the allowed-binary, foreign-binary, absolute-path, and interpreter-fetch cases per arm.

## Implementation Notes

The guard lives in `bench/guard.ts` and exposes a small interface over a deliberately deep implementation:

- `guardCommand(arm, command)` — the authoritative guard, returning `{ allowed: true }` or `{ allowed: false, reason }`.
- `provisionArmBin(arm, binDir, locate?)` — populates a per-arm bin directory with a single symlink to the arm's binary (empty for `gitea-mcp`); `locate` is an injectable resolver so tests stay host-independent.
- `ARM_BINARY` and `HARMLESS_BINARIES` — the per-arm allow-listed binary (`null` for the shell-disabled `gitea-mcp` arm) and the curated set of harmless read/text/flow utilities.

Depth added beyond the literal criteria, invited by ADR 0016 ("isolation strength rests on the completeness of the guard's deny rules"): the guard checks *every* binary a command would reach, not just the leading token, via a hand-rolled shell command parser (`extractCommands`) that handles pipelines, `;`/`&&`/`||` sequences, subshells, `$(...)` and backtick substitutions, process substitutions, redirections (including `2>&1` and `&>` forms), and leading `NAME=value` assignments. This closes pipe-hiding and substitution-hiding evasions in addition to the named absolute-path and interpreter-fetch cases. Path-qualified invocations are refused even for the arm's own binary, since the curated PATH is meant to resolve it by name and a path-qualified form is a symlink/copy evasion vector.

The `gitea-mcp` arm runs with the shell disabled entirely (no allow-listed binary), so `guardCommand` denies every shell command for it with a shell-disabled reason, and `provisionArmBin` exposes nothing.

Tests are colocated in `bench/guard.test.ts` (31 tests) and run via `npm run test:bench`, kept out of the `src/` coverage tier.
