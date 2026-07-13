import { axiError } from "./errors.js";

export interface FlagSpec {
  /** Flag names (e.g. "--state") mapped to how they are parsed. */
  [name: string]: {
    takesValue: boolean;
    /** Accumulate every occurrence into `lists` instead of `flags` (e.g. `--label`). */
    repeatable?: boolean;
  };
}

export interface ParsedFlags {
  /** Single-valued flags: the value, or `true` for a bare switch. */
  flags: Record<string, string | true>;
  /**
   * Values of each repeatable flag in argv order. Every repeatable flag in the
   * spec is present, holding an empty array when it was not passed.
   */
  lists: Record<string, string[]>;
  positionals: string[];
}

export interface SplitFlag {
  name: string;
  inlineValue?: string;
}

/**
 * Read a value-taking flag. `parseFlags` rejects such a flag without a value,
 * so anything present here is a string; the `true` case only arises for bare
 * switches, which callers never read through this helper.
 */
export function flagValue(
  flags: Record<string, string | true>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

/** ["open", "closed", "all"] → "open, closed, or all". */
function orList(values: readonly string[]): string {
  if (values.length < 2) {
    return values[0] ?? "";
  }
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

/**
 * Read a flag whose value must be one of a fixed set. Returns undefined when the
 * flag was absent, leaving the default to the caller — a flag with no default
 * (`--sort`) and one with a default (`--state`) then differ only in what they do
 * with that undefined.
 */
export function parseEnumFlag<T extends string>(
  value: string | true | undefined,
  name: string,
  allowed: readonly T[],
  suggestions: string[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || !allowed.includes(value as T)) {
    throw axiError(
      `Invalid ${name} value: ${String(value)} (expected ${orList(allowed)})`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  return value as T;
}

/**
 * Parse a flag's value as a positive integer, rejecting a bare switch or a
 * non-integer with a uniform `VALIDATION_ERROR`. `label` names the flag in the
 * message (e.g. "--limit", "--label-id"). Shared by every flag that takes one.
 */
export function parsePositiveInt(
  value: string | true,
  label: string,
  suggestions: string[] = [],
): number {
  const parsed = Number(value);
  if (value === true || !Number.isInteger(parsed) || parsed < 1) {
    throw axiError(
      `Invalid ${label} value: ${String(value)} (expected a positive integer)`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  return parsed;
}

/** Split "--flag=value" into name and inline value; "--flag" has none. */
export function splitFlag(arg: string): SplitFlag {
  const equals = arg.indexOf("=");
  if (equals === -1) {
    return { name: arg };
  }
  return { name: arg.slice(0, equals), inlineValue: arg.slice(equals + 1) };
}

/**
 * Resolve a value-taking flag's value from its inline form or the next
 * argument, returning the index of the last argument consumed.
 */
export function consumeFlagValue(
  args: string[],
  index: number,
  flag: SplitFlag,
  suggestions: string[] = [],
): { value: string; lastIndex: number } {
  if (flag.inlineValue !== undefined) {
    if (!flag.inlineValue) {
      throw axiError(`Flag ${flag.name} requires a value`, "VALIDATION_ERROR", suggestions);
    }
    return { value: flag.inlineValue, lastIndex: index };
  }
  const next = args[index + 1];
  if (next === undefined || next.startsWith("-")) {
    throw axiError(`Flag ${flag.name} requires a value`, "VALIDATION_ERROR", suggestions);
  }
  return { value: next, lastIndex: index + 1 };
}

/** "issue" → "an issue"; "pull request" → "a pull request". */
function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * Validate a single raw argument as a positive issue number. `noun` names what
 * the number identifies ("issue", "target") in the error; `suggestions` carries
 * the caller's help line. Shared by the single-positional parser and the
 * two-positional dependency parser so the rule and its message live in one place.
 */
export function parseIssueNumber(raw: string, noun: string, suggestions: string[]): number {
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    throw axiError(
      `Invalid ${noun} number: ${raw} (expected a positive integer)`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  return number;
}

/**
 * Parse the single positional number of a `<command> <number>` invocation.
 * `noun` names what the number identifies ("issue", "pull request") and appears
 * in the errors; the parsing itself is identical for both.
 */
export function parsePositionalNumber(
  positionals: string[],
  command: string,
  noun: string,
): number {
  const helpSuggestion = [`Run \`gitea-axi ${command} --help\` to see available flags`];
  if (positionals.length === 0) {
    throw axiError(
      `${command} requires ${withArticle(noun)} number`,
      "VALIDATION_ERROR",
      [`Run \`gitea-axi ${command} <number>\``],
    );
  }
  if (positionals.length > 1) {
    throw axiError(`Unexpected argument: ${positionals[1]}`, "VALIDATION_ERROR", helpSuggestion);
  }
  return parseIssueNumber(positionals[0]!, noun, helpSuggestion);
}

export function parseFlags(
  args: string[],
  spec: FlagSpec,
  helpCommand: string,
): ParsedFlags {
  const flags: Record<string, string | true> = {};
  const lists: Record<string, string[]> = {};
  for (const [name, entry] of Object.entries(spec)) {
    if (entry.repeatable) {
      lists[name] = [];
    }
  }
  const positionals: string[] = [];
  const helpSuggestion = [`Run \`gitea-axi ${helpCommand} --help\` to see available flags`];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    const flag = splitFlag(arg);
    const entry = spec[flag.name];
    if (!entry) {
      throw axiError(`Unknown flag: ${flag.name}`, "VALIDATION_ERROR", helpSuggestion);
    }
    if (!entry.takesValue) {
      if (flag.inlineValue !== undefined) {
        throw axiError(`Flag ${flag.name} does not take a value`, "VALIDATION_ERROR", helpSuggestion);
      }
      flags[flag.name] = true;
      continue;
    }
    const consumed = consumeFlagValue(args, i, flag, helpSuggestion);
    if (entry.repeatable) {
      lists[flag.name]!.push(consumed.value);
    } else {
      flags[flag.name] = consumed.value;
    }
    i = consumed.lastIndex;
  }
  return { flags, lists, positionals };
}
