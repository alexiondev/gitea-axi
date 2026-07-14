import type { CliDeps } from "../deps.js";
import { axiError } from "../errors.js";

/**
 * Shadow axi-sdk-js's built-in `update` self-update command (ADR 0013). The
 * built-in would query npmjs.org and rewrite the install under its own
 * `UPDATE_ERROR` code — an unspecced command and an eleventh error code on top
 * of the documented ten. This handler rejects the command with a
 * `VALIDATION_ERROR` and points at the explicit npm update instead, so the
 * SDK's `UPDATE_ERROR` never surfaces and the command surface stays as specced.
 */
export function updateCommand(_deps: CliDeps) {
  return async (): Promise<string> => {
    throw axiError(
      "gitea-axi does not self-update",
      "VALIDATION_ERROR",
      ["Run `npm install -g gitea-axi@latest` to update"],
    );
  };
}
