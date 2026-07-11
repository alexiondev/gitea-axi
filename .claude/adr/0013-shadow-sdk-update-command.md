# Shadow the axi-sdk-js `update` built-in

axi-sdk-js reserves `update` as a built-in self-update command (`RESERVED_COMMANDS`): it queries npmjs.org for the latest published version of the tool and updates the install, throwing its own `UPDATE_ERROR` code on failure.
gitea-axi shadows it with a handler that rejects the command.

## Considered Options

**Keep the built-in** (rejected) — Free functionality and consistent with other axi-sdk-js tools, but it silently adds an unspecced command to the surface and an eleventh error code (`UPDATE_ERROR`) to the documented ten.
Self-updating from inside unattended agent sessions is also a write to the operator's toolchain that should stay an explicit human action.

**Shadow it** (chosen) — `gitea-axi update` fails with `VALIDATION_ERROR` and a help line: `` Run `npm install -g gitea-axi@latest` to update ``.
The failure is instructive rather than an opaque unknown-command error.

## Consequences

- The command surface and the ten-code `AxiError` list stay exactly as specified.
- Updating gitea-axi is always an explicit npm action.
- If the SDK's reserved-command list grows, each new built-in needs the same adopt-or-shadow decision.
