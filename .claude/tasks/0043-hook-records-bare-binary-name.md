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

- [ ] The recorded hook command is the bare binary name whenever that name resolves to the running program on `PATH`.
- [ ] The recorded hook command remains the absolute entrypoint path when the binary is not resolvable on `PATH`, and that fallback is exercised by a test.
- [ ] Re-running `setup hooks` updates the existing entry in place rather than appending a second one, including when the entrypoint path does not contain the marker.
- [ ] The `setup` help text no longer instructs the user to re-run hooks after an upgrade, that instruction having become false.
- [ ] The derivation no longer renames its build tree, and the build still passes with the tree at a path that does not contain the marker.
- [ ] The behaviour is verified against a real wrapper-based install, not only against a source checkout.
