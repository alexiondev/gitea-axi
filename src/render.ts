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

export interface RenderListOptions {
  noun: string;
  rows: Record<string, unknown>[];
  countLine: string;
  help: string[];
}

export function renderList(options: RenderListOptions): string {
  const body =
    options.rows.length > 0
      ? encode({ [options.noun]: options.rows })
      : `${options.noun}[0]: (none)`;
  return [options.countLine, body, encode({ help: options.help })].join("\n");
}
