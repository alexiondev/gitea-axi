import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CliDeps } from "./deps.js";
import { axiError } from "./errors.js";
import { flagValue } from "./flags.js";

/**
 * Resolve the body text a mutation should send from its `--body`/`--body-file`
 * flags. Shared by every command that accepts a body (issue create, issue
 * comment, and the edit/close commands that follow).
 *
 * The two flags are mutually exclusive: accepting both and picking a winner
 * would silently discard text the caller meant to send.
 */
export function resolveBodySource(
  deps: CliDeps,
  flags: Record<string, string | true>,
  command: string,
): string | undefined {
  const body = flagValue(flags, "--body");
  const path = flagValue(flags, "--body-file");

  if (body !== undefined && path !== undefined) {
    throw axiError(
      "Flags --body and --body-file are mutually exclusive",
      "VALIDATION_ERROR",
      bodyFlagSuggestion(command),
    );
  }
  if (body !== undefined) {
    return body;
  }
  if (path !== undefined) {
    return readBodyFile(deps, path, command);
  }
  return undefined;
}

/** As {@link resolveBodySource}, for the commands where a body is mandatory. */
export function requireBodySource(
  deps: CliDeps,
  flags: Record<string, string | true>,
  command: string,
): string {
  const body = resolveBodySource(deps, flags, command);
  if (body === undefined) {
    throw axiError(
      `${command} requires --body <text> or --body-file <path>`,
      "VALIDATION_ERROR",
      bodyFlagSuggestion(command),
    );
  }
  return body;
}

function bodyFlagSuggestion(command: string): string[] {
  return [
    `Run \`gitea-axi ${command} --body <text>\` or \`gitea-axi ${command} --body-file <path>\``,
  ];
}

function readBodyFile(deps: CliDeps, path: string, command: string): string {
  const absolute = isAbsolute(path) ? path : resolve(deps.cwd, path);
  try {
    return readFileSync(absolute, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw axiError(
      `Cannot read --body-file ${path}: ${reason}`,
      "VALIDATION_ERROR",
      bodyFlagSuggestion(command),
    );
  }
}
