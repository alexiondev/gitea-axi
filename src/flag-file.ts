import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CliDeps } from "./deps.js";
import { axiError } from "./errors.js";

/**
 * Read the file a path-valued flag points at, resolved against the caller's cwd.
 * A missing or unreadable file is a `VALIDATION_ERROR` naming the flag — the
 * shared reader behind `--body-file` and `--comments-file`. Parsing the contents
 * (as text, JSON, …) is the caller's job; this only turns a path into bytes.
 */
export function readFlagFile(
  deps: CliDeps,
  path: string,
  flag: string,
  suggestion: string[],
): string {
  const absolute = isAbsolute(path) ? path : resolve(deps.cwd, path);
  try {
    return readFileSync(absolute, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw axiError(`Cannot read ${flag} ${path}: ${reason}`, "VALIDATION_ERROR", suggestion);
  }
}
