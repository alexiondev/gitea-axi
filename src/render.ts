import { encode } from "@toon-format/toon";

// Same shape the SDK's own error formatter produces; its renderError helper
// exists in axi-sdk-js but is not exported from the package index.
export function renderErrorOutput(
  message: string,
  code: string,
  suggestions: string[] = [],
): string {
  const output: Record<string, unknown> = { error: message, code };
  if (suggestions.length > 0) {
    output.help = suggestions;
  }
  return encode(output);
}

export function formatCountLine(
  shown: number,
  total: number | undefined,
  atLimit: boolean,
): string {
  if (total === undefined) {
    if (atLimit) {
      return `count: ${shown} (showing first ${shown})`;
    }
    return `count: ${shown} of ${shown} total`;
  }
  return `count: ${shown} of ${total} total`;
}

/** Encode a named list block, with an explicit empty-state line when there are no rows. */
function encodeRows(noun: string, rows: Record<string, unknown>[]): string {
  return rows.length > 0 ? encode({ [noun]: rows }) : `${noun}[0]: (none)`;
}

export interface RenderListOptions {
  noun: string;
  rows: Record<string, unknown>[];
  countLine: string;
  help: string[];
}

export function renderList(options: RenderListOptions): string {
  const body = encodeRows(options.noun, options.rows);
  return [options.countLine, body, encode({ help: options.help })].join("\n");
}

/**
 * A literal `noun: value` line followed by the help block — for output whose
 * entity is a single line rather than a field map or a list (e.g. the no-CI
 * `checks:` message). The value is emitted verbatim, not re-encoded: TOON reads
 * a string scalar to end of line, so a comma-bearing message stays unquoted,
 * matching the way a summary line stands above a list block.
 */
export function renderScalar(noun: string, value: string, help: string[]): string {
  return [`${noun}: ${value}`, encode({ help })].join("\n");
}

/**
 * A flat top-level field map followed by the help block — for outputs whose
 * fields sit at the top level rather than nested under an entity noun (e.g.
 * `created: ok` / `label: <name>`). Distinct from {@link renderDetail}, which
 * wraps its fields in a `noun:` block.
 */
export function renderObject(item: Record<string, unknown>, help: string[]): string {
  return [encode(item), encode({ help })].join("\n");
}

/** A secondary list block appended below a detail entity (e.g. comments). */
export interface DetailBlock {
  noun: string;
  rows: Record<string, unknown>[];
}

export interface RenderDetailOptions {
  noun: string;
  item: Record<string, unknown>;
  blocks?: DetailBlock[];
  help: string[];
}

export function renderDetail(options: RenderDetailOptions): string {
  const parts = [encode({ [options.noun]: options.item })];
  for (const block of options.blocks ?? []) {
    parts.push(encodeRows(block.noun, block.rows));
  }
  parts.push(encode({ help: options.help }));
  return parts.join("\n");
}
