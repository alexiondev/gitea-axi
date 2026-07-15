---
spec: benchmark-harness
---

## What to build

The guard that keeps each arm's agent confined to exactly one tool, so a benchmark result measures the tool rather than the agent's choice between tools (see the guard-based-tool-isolation ADR).

The guard is a callback that inspects every proposed shell command and permits only the one binary allow-listed for the active arm plus a curated set of harmless utilities, denying everything else. It rejects foreign binaries, absolute-path evasions that sidestep the allow-list, and interpreter-based fetch tricks (reaching the API through a language runtime's HTTP client). A curated per-arm PATH backs the guard as a convenience layer, but the guard — not the PATH — is authoritative. A blocked attempt is surfaced, not silently retried.

## Acceptance criteria

- [ ] Each arm's allow-listed binary passes the guard; a foreign binary is denied.
- [ ] An absolute-path invocation of a foreign binary is denied.
- [ ] An interpreter-based fetch attempt (e.g. driving an HTTP request through a language runtime) is denied.
- [ ] A curated per-arm PATH is produced exposing only that arm's allowed binary.
- [ ] Unit tests cover the allowed-binary, foreign-binary, absolute-path, and interpreter-fetch cases per arm.
