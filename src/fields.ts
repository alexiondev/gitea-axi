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

export function relativeTimeField<T>(name: string, path: string): FieldDef<T> {
  return {
    name,
    extract: (raw, context) => {
      const value = pluckPath(raw, path);
      return relativeTime(typeof value === "string" ? value : undefined, context.now);
    },
  };
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
