import { axiError } from "./errors.js";
import { relativeTime } from "./time.js";

export interface ExtractContext {
  now: Date;
}

export interface FieldDef<T> {
  name: string;
  extract: (raw: T, context: ExtractContext) => unknown;
}

function pluckPath(raw: unknown, path: string): unknown {
  let value: unknown = raw;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function pluck<T>(name: string, path: string = name): FieldDef<T> {
  return { name, extract: (raw) => pluckPath(raw, path) ?? "" };
}

export function lowercased<T>(name: string, path: string = name): FieldDef<T> {
  return {
    name,
    extract: (raw) => String(pluckPath(raw, path) ?? "").toLowerCase(),
  };
}

/**
 * Join a field holding an array of objects (labels, assignees) into a single
 * string of each element's `key` property.
 */
export function joined<T>(name: string, path: string, key: string): FieldDef<T> {
  return {
    name,
    extract: (raw) => {
      const value = pluckPath(raw, path);
      if (!Array.isArray(value)) {
        return "";
      }
      return value
        .map((item) => pluckPath(item, key))
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .join(", ");
    },
  };
}

export function relativeTimeField<T>(name: string, path: string): FieldDef<T> {
  return {
    name,
    extract: (raw, context) => {
      const value = pluckPath(raw, path);
      return relativeTime(typeof value === "string" ? value : undefined, context.now);
    },
  };
}

/**
 * Resolve a comma-separated `--fields` value against the extra fields a command
 * offers on top of its defaults. Unknown names are a `VALIDATION_ERROR` naming
 * what is available, since a silently ignored field would look like a command
 * that returned nothing for it.
 */
export function selectExtraFields<T>(
  value: string | undefined,
  registry: Record<string, FieldDef<T>>,
  command: string,
): FieldDef<T>[] {
  if (value === undefined) {
    return [];
  }
  const available = Object.keys(registry);
  const suggestion = [
    `Run \`gitea-axi ${command} --fields <a,b,c>\` with any of: ${available.join(", ")}`,
  ];
  const selected: FieldDef<T>[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const field = registry[name];
    if (!field) {
      throw axiError(
        `Unknown --fields name: ${name} (available: ${available.join(", ")})`,
        "VALIDATION_ERROR",
        suggestion,
      );
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    selected.push(field);
  }
  return selected;
}

export function extractRow<T>(
  raw: T,
  fields: FieldDef<T>[],
  context: ExtractContext,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of fields) {
    row[field.name] = field.extract(raw, context);
  }
  return row;
}
