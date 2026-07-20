import { readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Filesystem reads {@link resolveEntrypointOnPath} needs, injectable for tests. */
export interface PathProbe {
  /** The resolved real path of `candidate`, or `undefined` if it is not a file. */
  realPath: (candidate: string) => string | undefined;
  /** The contents of `candidate`, or `undefined` if it cannot be read as text. */
  readText: (candidate: string) => string | undefined;
}

/**
 * Where `name` resolves on `pathValue` *to the program running `entrypoint`*, or
 * `undefined` when it resolves nowhere, or resolves to some other program.
 *
 * This exists so `setup hooks` can hand the agent SDK the location the binary
 * actually resolves to on `PATH` rather than the module-relative entrypoint.
 * The SDK records a bare, upgrade-stable name only when a `PATH` entry
 * realpath-matches the path it is given, and from the entrypoint's side that
 * can only ever succeed under npm, which symlinks its `bin` entry straight at
 * it. A wrapper-based install cannot: a script that *invokes* a file never
 * resolves *to* that file.
 *
 * The two install shapes are therefore recognised on their own terms:
 *
 * - a **symlink** to the entrypoint, matched by realpath — npm's shape;
 * - a **generated wrapper** naming the entrypoint in its text, matched by
 *   containment — the shape Nix, shims and `.cmd` launchers all produce.
 *
 * Wrappers chain, so containment follows the references a wrapper makes to
 * other files rather than only reading the first one. A Nix install is two
 * hops: `bin/gitea-axi` sets `PATH` and execs `bin/.gitea-axi-wrapped`, which
 * is what actually names the entrypoint.
 *
 * Requiring one of these is what keeps the answer honest. Accepting any file
 * that merely *bears the name* would hand the SDK a path that trivially
 * realpath-matches itself, turning its check into a tautology and recording a
 * bare name that resolves to a different program than the one asked.
 *
 * Windows `PATHEXT` suffixes are deliberately not tried. The package supports
 * Linux and macOS, and wherever the lookup misses — an unreadable wrapper, a
 * compiled launcher, a chain deeper than {@link MAX_WRAPPER_HOPS} — the
 * caller's absolute-path fallback still produces a working hook.
 */
export function resolveEntrypointOnPath(
  name: string,
  entrypoint: string,
  pathValue: string | undefined,
  probe: PathProbe = defaultPathProbe,
): string | undefined {
  const entrypointReal = probe.realPath(entrypoint);

  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, name);
    const candidateReal = probe.realPath(candidate);
    if (!candidateReal) {
      continue;
    }
    if (entrypointReal !== undefined && candidateReal === entrypointReal) {
      return candidate;
    }
    if (wrapperLeadsTo(candidate, entrypoint, probe)) {
      return candidate;
    }
  }
  return undefined;
}

/** How many wrapper-to-wrapper hops to follow. Nix needs two; the cap is slack. */
const MAX_WRAPPER_HOPS = 4;

/** How many files one lookup may read before giving up, so a dense chain cannot run away. */
const MAX_WRAPPER_FILES = 32;

/** Absolute paths appearing in a script's text, stopping at shell quoting and separators. */
function absolutePathsIn(text: string): string[] {
  return text.match(/\/[^\s"';|&()]+/g) ?? [];
}

/** Whether `start`, followed through the files it names, ends up naming `entrypoint`. */
function wrapperLeadsTo(start: string, entrypoint: string, probe: PathProbe): boolean {
  const seen = new Set<string>();
  let frontier = [start];

  for (let hop = 0; hop <= MAX_WRAPPER_HOPS && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const file of frontier) {
      if (seen.has(file) || seen.size >= MAX_WRAPPER_FILES) {
        continue;
      }
      seen.add(file);

      const text = probe.readText(file);
      if (text === undefined) {
        continue;
      }
      if (text.includes(entrypoint)) {
        return true;
      }
      for (const referenced of absolutePathsIn(text)) {
        if (!seen.has(referenced) && probe.realPath(referenced)) {
          next.push(referenced);
        }
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Anything much larger than a wrapper script is not one. The cap keeps a chain
 * that happens to name `node` or `bash` from reading whole binaries back.
 */
const MAX_WRAPPER_BYTES = 64 * 1024;

const defaultPathProbe: PathProbe = {
  realPath: (candidate) => {
    try {
      return statSync(candidate).isFile() ? realpathSync(candidate) : undefined;
    } catch {
      return undefined;
    }
  },
  readText: (candidate) => {
    try {
      if (statSync(candidate).size > MAX_WRAPPER_BYTES) {
        return undefined;
      }
      return readFileSync(candidate, "utf8");
    } catch {
      return undefined;
    }
  },
};

interface HookEntry {
  command?: unknown;
}

interface HookGroup {
  hooks?: unknown;
}

interface HookSettings {
  hooks?: { SessionStart?: unknown };
}

/**
 * Collapse repeated managed SessionStart entries down to the last one, which is
 * the entry the SDK has just written or refreshed.
 *
 * The SDK recognises its own hook by testing whether the recorded command
 * *contains* the marker, so an entrypoint path that happens not to contain
 * "gitea-axi" makes a re-run append a second entry instead of updating the
 * first — contradicting the idempotency `setup` promises. Recognition here does
 * not depend on the command's shape: callers pass an `isManaged` that matches
 * the exact command this run records, so a re-run identifies its own previous
 * entry by equality rather than by a substring accident — and a hook belonging
 * to another tool is never a candidate, whatever its command happens to spell.
 *
 * The *last* match survives. Every match holds the identical command, so the
 * choice can only affect `type` and `timeout`, and the last is the entry the
 * SDK has just appended in the case this exists to repair.
 *
 * Groups left with no hooks are dropped rather than kept as empty objects.
 */
export function pruneDuplicateManagedHooks(
  settings: unknown,
  isManaged: (command: string) => boolean,
): { settings: unknown; changed: boolean } {
  const pruned = structuredClone(settings) as HookSettings | null;
  const groups = pruned?.hooks?.SessionStart;
  if (!Array.isArray(groups)) {
    return { settings, changed: false };
  }

  const isManagedHook = (hook: HookEntry) =>
    typeof hook?.command === "string" && isManaged(hook.command);

  const managedCount = (groups as HookGroup[]).reduce(
    (total, group) =>
      total +
      (Array.isArray(group?.hooks) ? (group.hooks as HookEntry[]).filter(isManagedHook).length : 0),
    0,
  );
  if (managedCount < 2) {
    return { settings, changed: false };
  }

  // Every managed entry but the last is a leftover from an earlier run.
  let remaining = managedCount - 1;
  const kept: HookGroup[] = [];
  for (const group of groups as HookGroup[]) {
    if (!Array.isArray(group?.hooks)) {
      kept.push(group);
      continue;
    }
    const survivors = (group.hooks as HookEntry[]).filter((hook) => {
      if (remaining > 0 && isManagedHook(hook)) {
        remaining--;
        return false;
      }
      return true;
    });
    if (survivors.length > 0) {
      group.hooks = survivors;
      kept.push(group);
    }
  }
  (pruned as HookSettings).hooks = { ...pruned?.hooks, SessionStart: kept };

  return { settings: pruned, changed: true };
}
