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
