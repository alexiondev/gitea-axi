import { axiError } from "./errors.js";

export interface FlagSpec {
  /** Flag names (e.g. "--state") mapped to whether they take a value. */
  [name: string]: { takesValue: boolean };
}

export interface ParsedFlags {
  flags: Record<string, string | true>;
  positionals: string[];
}

export interface SplitFlag {
  name: string;
  inlineValue?: string;
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

export function parseFlags(
  args: string[],
  spec: FlagSpec,
  helpCommand: string,
): ParsedFlags {
  const flags: Record<string, string | true> = {};
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
    flags[flag.name] = consumed.value;
    i = consumed.lastIndex;
  }
  return { flags, positionals };
}
