import { accessSync, constants, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Arm } from "./result.js";

/**
 * The single binary each arm's agent is allowed to invoke through the shell.
 * `null` marks an arm that runs with the shell disabled entirely (gitea-mcp,
 * which reaches Gitea only through its attached MCP tools and so has no shell
 * leakage surface at all).
 */
export const ARM_BINARY: Record<Arm, string | null> = {
  "gitea-axi": "gitea-axi",
  tea: "tea",
  "gitea-mcp": null,
  "raw-api": "curl",
};

/**
 * The curated set of harmless utilities any arm may reach in addition to its own
 * allow-listed binary. Every entry is a read/text/flow utility that cannot reach
 * the network or execute arbitrary code. The set deliberately excludes anything
 * that can launch another program or open a socket — language interpreters
 * (python, node, ruby, perl, php, lua), shells (sh, bash, zsh), program-launching
 * wrappers (env, xargs, find, timeout, nohup, nice), code-capable text tools
 * (sed, awk), and every network tool (curl, wget, nc, ssh, git). Those are the
 * evasion surface the guard exists to close, so none of them is "harmless".
 */
export const HARMLESS_BINARIES: ReadonlySet<string> = new Set([
  "cat", "head", "tail", "wc", "cut", "tr", "sort", "uniq", "comm",
  "grep", "egrep", "fgrep", "diff", "echo", "printf", "ls", "pwd", "cd",
  "mkdir", "rmdir", "tee", "test", "[", "true", "false", "basename",
  "dirname", "seq", "sleep", "date", "nl", "rev", "tac", "fold", "column",
  "expr", "jq",
]);

/** The guard's verdict on one proposed shell command. */
export type GuardDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * The authoritative tool-isolation guard. Inspects a proposed shell command and
 * permits it only if every binary it would reach is either the active arm's one
 * allow-listed binary or a curated harmless utility. Foreign binaries,
 * absolute-path evasions, and interpreter-based fetch tricks are denied.
 */
export function guardCommand(arm: Arm, command: string): GuardDecision {
  const allowed = ARM_BINARY[arm];
  if (allowed === null) {
    return {
      allowed: false,
      reason: `the ${arm} arm runs with the shell disabled; only its MCP tools are available`,
    };
  }
  const commands = extractCommands(command);
  if (commands.length === 0) {
    return { allowed: false, reason: "no command was found to run" };
  }
  for (const name of commands) {
    if (name.includes("/")) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      return {
        allowed: false,
        reason: `path-qualified command "${name}" is not permitted; invoke "${base}" by name so the ${arm} arm's curated PATH governs which binary resolves`,
      };
    }
    if (name === allowed) {
      continue;
    }
    if (HARMLESS_BINARIES.has(name)) {
      continue;
    }
    return {
      allowed: false,
      reason: `"${name}" is not permitted for the ${arm} arm; only "${allowed}" and curated read-only utilities are allowed`,
    };
  }
  return { allowed: true };
}

/** Whether `word` is a leading `NAME=value` environment assignment, not a command. */
function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

/**
 * Extract every command name a shell command line would reach — across pipelines,
 * sequences (`;`, `&&`, `||`), subshells, command substitutions (`$(...)` and
 * backticks), and process substitutions. Leading `NAME=value` assignments and
 * redirections (including forms like `2>&1`) are skipped so only genuine command
 * names are returned. The guard checks every returned name, which is what stops a
 * foreign binary from hiding downstream of a pipe or inside a substitution.
 */
function extractCommands(command: string): string[] {
  const s = command;
  const len = s.length;
  const cur = { i: 0 };
  const names: string[] = [];

  const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\r";
  const isWordBreak = (c: string | undefined): boolean =>
    c === undefined ||
    isSpace(c) ||
    c === "\n" ||
    c === "|" ||
    c === "&" ||
    c === ";" ||
    c === "(" ||
    c === ")" ||
    c === "{" ||
    c === "}" ||
    c === "<" ||
    c === ">" ||
    c === "`";

  function skipSpaces(): void {
    while (cur.i < len && isSpace(s[cur.i])) cur.i++;
  }

  // Read one word starting at cur.i, honoring single/double quotes and backslash
  // escapes, and recursing into any `$(...)` / backtick substitution embedded in
  // a double-quoted span so its command names are captured too.
  function readWord(): string {
    let w = "";
    while (cur.i < len) {
      const c = s[cur.i];
      if (c === "'") {
        cur.i++;
        while (cur.i < len && s[cur.i] !== "'") {
          w += s[cur.i];
          cur.i++;
        }
        cur.i++;
        continue;
      }
      if (c === '"') {
        cur.i++;
        while (cur.i < len && s[cur.i] !== '"') {
          if (s[cur.i] === "\\") {
            w += s[cur.i + 1] ?? "";
            cur.i += 2;
            continue;
          }
          if (s[cur.i] === "$" && s[cur.i + 1] === "(") {
            cur.i += 2;
            parseSequence(")");
            continue;
          }
          if (s[cur.i] === "`") {
            cur.i++;
            parseSequence("`");
            continue;
          }
          w += s[cur.i];
          cur.i++;
        }
        cur.i++;
        continue;
      }
      if (c === "\\") {
        w += s[cur.i + 1] ?? "";
        cur.i += 2;
        continue;
      }
      if (c === "$" && s[cur.i + 1] === "(") break;
      if (isWordBreak(c)) break;
      w += c;
      cur.i++;
    }
    return w;
  }

  // Consume a redirection operator (cur.i is at `<` or `>`) and its target, so
  // neither the operator nor the target file/descriptor is mistaken for a command.
  function consumeRedirection(): void {
    cur.i++; // the leading < or >
    if (s[cur.i] === ">" || s[cur.i] === "<") cur.i++; // >>, <<, <>
    if (s[cur.i] === "&") cur.i++; // >&, <& (duplicate a descriptor)
    skipSpaces();
    if (s[cur.i] === "-") {
      cur.i++; // close a descriptor: >&-
      return;
    }
    if (cur.i < len && s[cur.i] === "$" && s[cur.i + 1] === "(") {
      cur.i += 2;
      parseSequence(")");
      return;
    }
    if (cur.i < len && !isWordBreak(s[cur.i])) {
      readWord(); // discard the redirection target
    }
  }

  // Parse a run of commands until end of input, or until `closer` (`)` for a
  // subshell/substitution, `` ` `` for a backtick substitution) is reached.
  function parseSequence(closer: string | null): void {
    let expectCommand = true;
    while (cur.i < len) {
      skipSpaces();
      const c = s[cur.i];
      if (c === undefined) break;
      if (closer !== null && c === closer) {
        cur.i++;
        return;
      }
      if (c === "\n" || c === ";") {
        cur.i++;
        expectCommand = true;
        continue;
      }
      if (c === "&") {
        if (s[cur.i + 1] === ">") {
          cur.i++; // `&>` / `&>>` redirect both streams
          consumeRedirection();
          continue;
        }
        cur.i++;
        if (s[cur.i] === "&") cur.i++; // && vs background &
        expectCommand = true;
        continue;
      }
      if (c === "|") {
        cur.i++;
        if (s[cur.i] === "|" || s[cur.i] === "&") cur.i++; // ||, |&
        expectCommand = true;
        continue;
      }
      if (c === "(") {
        cur.i++;
        parseSequence(")");
        expectCommand = false;
        continue;
      }
      if (c === "{") {
        cur.i++;
        expectCommand = true;
        continue;
      }
      if (c === "}") {
        cur.i++;
        continue;
      }
      if (c === "`") {
        if (closer === "`") {
          cur.i++;
          return;
        }
        cur.i++;
        parseSequence("`");
        expectCommand = false;
        continue;
      }
      if (c === "$" && s[cur.i + 1] === "(") {
        cur.i += 2;
        parseSequence(")");
        expectCommand = false;
        continue;
      }
      if (c === "<" || c === ">") {
        consumeRedirection();
        continue;
      }
      const word = readWord();
      if (/^\d+$/.test(word) && (s[cur.i] === "<" || s[cur.i] === ">")) {
        consumeRedirection(); // a file-descriptor prefix, e.g. 2>&1
        continue;
      }
      if (word.length === 0) continue;
      if (expectCommand) {
        if (isAssignment(word)) continue; // NAME=value prefix; the command follows
        names.push(word);
        expectCommand = false;
      }
    }
  }

  parseSequence(null);
  return names;
}

/**
 * Provision a curated per-arm bin directory that exposes only the arm's one
 * allow-listed binary, as a convenience layer behind the authoritative guard.
 *
 * The directory is populated with a single symlink named after the arm's binary
 * pointing at its resolved absolute path, so prepending the directory to PATH
 * lets the arm's tool resolve by name while no foreign binary is reachable that
 * way. The gitea-mcp arm has no shell binary, so its directory is left empty.
 * `locate` resolves a binary name to an absolute path (defaulting to a search of
 * the real PATH); a test injects a deterministic fake.
 */
export function provisionArmBin(
  arm: Arm,
  binDir: string,
  locate: (binary: string) => string | null = locateOnPath,
): void {
  mkdirSync(binDir, { recursive: true });
  const binary = ARM_BINARY[arm];
  if (binary === null) {
    return; // gitea-mcp: the shell is disabled, so nothing is exposed.
  }
  const target = locate(binary);
  if (target === null) {
    throw new Error(
      `cannot provision the ${arm} arm: its binary "${binary}" was not found on PATH`,
    );
  }
  symlinkSync(target, join(binDir, binary));
}

/** Resolve `binary` to the absolute path of the first executable of that name on PATH. */
function locateOnPath(binary: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here (or not executable); keep looking.
    }
  }
  return null;
}
