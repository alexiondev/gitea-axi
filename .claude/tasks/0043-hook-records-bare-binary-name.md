---
spec: nix-flake-packaging
---

## What to build

Make the SessionStart hook survive an upgrade by recording a name that does not move.

Task 0042 established by observation that the hook records the entrypoint's absolute path on every wrapper-based install, and documented a re-run-after-upgrade mitigation.
This task removes the need for that mitigation.

The SDK returns the bare binary name only when a `PATH` entry realpath-matches the entrypoint it is handed.
An npm install satisfies that by symlinking its `bin` entry straight at the entrypoint; a wrapper-based install cannot, because a script that *invokes* a file never resolves *to* that file.
Handing the SDK the location where the binary actually resolves on `PATH`, rather than the module-relative entrypoint, makes the match succeed and the bare name get recorded — using the SDK's own resolution rather than bypassing it.
When the binary is not on `PATH` there is nothing to hand it, and the existing absolute-path behaviour stands unchanged as the fallback.

This is not a Nix accommodation.
Any wrapper-based install has the same shape — a shim, a launcher, a generated `.cmd` — and the fix is the convention for tools that write into user-owned configuration: prior art records a bare name and lets `PATH` resolve it, reserving absolute paths for configuration that a package manager regenerates.

A second defect shares the same line and is fixed here.
The hook is recognised as its own by testing whether the recorded command string *contains* the marker, so an entrypoint path lacking that substring makes re-running `setup hooks` append a duplicate rather than update in place, contradicting the idempotency its help text promises.
Recording the bare name makes the marker match by construction, but the recognition itself should not depend on the recorded command's shape.

The Nix derivation renames its build tree solely to work around that substring coupling.
Once the coupling is gone the rename has no remaining purpose and goes with it.

## Acceptance criteria

- [x] The recorded hook command is the bare binary name whenever that name resolves to the running program on `PATH`.
- [x] The recorded hook command remains the absolute entrypoint path when the binary is not resolvable on `PATH`, and that fallback is exercised by a test.
- [x] Re-running `setup hooks` updates the existing entry in place rather than appending a second one, including when the entrypoint path does not contain the marker.
- [x] The `setup` help text no longer instructs the user to re-run hooks after an upgrade, that instruction having become false.
- [x] The derivation no longer renames its build tree, and the build still passes with the tree at a path that does not contain the marker.
- [x] The behaviour is verified against a real wrapper-based install, not only against a source checkout.

## Implementation Notes

The decision is recorded as [ADR 0019](../adr/0019-hook-records-search-path-name.md).
ADR 0009's addendum claimed the SDK registers the bare binary as the hook command, which held only for npm; it is amended in place.
The spec's "Resolved verification item" section, which concluded the bare name was unreachable through a wrapper, is rewritten to record that task 0043 superseded it.

### Resolving the name had to be stricter than first written

The first cut accepted any executable file named `gitea-axi` on `PATH` and handed it to the SDK.
That satisfied the letter of the change — the SDK's realpath test passed and the bare name got recorded — but only because the path handed over trivially matched itself, which made the SDK's check a tautology rather than a use of it.
Criterion 1 asks for the name to resolve *to the running program*, and that version would have recorded a bare name for a different `gitea-axi` shadowing this one on `PATH`.

`resolveEntrypointOnPath` therefore requires the candidate to be either a symlink whose realpath is the entrypoint (npm's shape) or a wrapper that names the entrypoint in its text (the generated shape).
Driving the real Nix binary showed the wrapper case is two hops, not one: `bin/gitea-axi` sets `PATH` and execs `bin/.gitea-axi-wrapped`, and only that second script names the entrypoint.
Containment follows the chain, bounded by hop, file-count and file-size caps so a dense chain cannot run away, and falls back to the absolute path wherever it cannot reach the entrypoint.

### Recognising the tool's own hook

The SDK's `isManagedHook` is a substring test against the recorded command and is not ours to change, so `setup hooks` prunes duplicates itself after the SDK writes.
An early version's predicate was `recorded === command || recorded.includes("gitea-axi")`, which reintroduced the very coupling this task removes and could have deleted an unrelated tool's hook whose command merely mentioned `gitea-axi`.
It is now exact-equality only.
That is sufficient: a *re-run* records an identical command, and the upgrade case is handled by the bare name being stable in the first place.

Duplicates are pruned only from `~/.claude/settings.json` and `~/.codex/hooks.json`.
The third integration, OpenCode, is a plugin file the SDK rewrites wholesale behind its own managed marker, so it cannot accumulate duplicates.

### Verification

Criterion 6 was met by driving the built Nix binary rather than by a test, since no test tier installs a wrapper.
Against `result/bin/gitea-axi`: on `PATH` records `gitea-axi`; off `PATH` records the store entrypoint path; a same-named impostor on `PATH` falls back rather than recording the name; and re-running in both the on-`PATH` and fallback cases leaves exactly one entry.
A globally `npm install`-ed pack of the same tree records `gitea-axi` through its symlinked `bin`, confirming the npm shape still resolves.

Criterion 5 is what `nix build` now demonstrates: with `postUnpack` deleted the fast tier runs from `/build/source`, a path with no marker in it, and the re-run idempotency test passes there — which it could not before the pruning change.
