# Guard-based tool isolation instead of containers

The benchmark's validity depends on each arm's agent reaching exactly one tool.
If the tea-arm agent could quietly call `curl` or `gitea-axi`, the comparison would be meaningless.
The benchmark machine has no container runtime available, so per-arm operating-system sandboxing is not an option.

## Considered Options

**Container per arm** (rejected) — A container image carrying only the arm's binary would give hard, kernel-level isolation, but it requires installing and depending on a container runtime the maintainer does not have and declined to add for this benchmark.

**Curated PATH alone** (rejected) — Prepending a directory that exposes only the allowed binary is convenient but leaky: an agent can invoke another tool by absolute path, or reach the API through a language interpreter's fetch, bypassing PATH entirely.

**Guard callback as the authority** (chosen) — A callback inspects every proposed shell command and permits only the one binary allow-listed for the active arm plus harmless utilities, denying foreign binaries, absolute-path evasions, and interpreter-based fetch attempts.
A curated per-arm PATH backs it as a convenience layer, and the gitea-mcp arm disables the shell tool entirely and attaches only the MCP tools, giving that arm no leakage surface at all.

## Consequences

- The guard, not the PATH, is authoritative; the PATH is defense in depth.
- A blocked attempt is left in the transcript and counts as realistic wasted effort, reflecting an agent fumbling with a tool that cannot do the job; blocked calls are never silently retried or discarded.
- Every command is logged, and a post-run audit asserts no foreign tool was reached; a detected leak flags the trial invalid rather than letting it be scored.
- Isolation strength rests on the completeness of the guard's deny rules, so the guard is one of the harness's primary unit-tested seams, covering absolute-path and interpreter-fetch evasions explicitly.
