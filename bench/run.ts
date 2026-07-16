// The maintainer-facing run-loop command: run one chosen benchmark cell on demand.
//
// This is the entry point the maintainer invokes to spend the token budget
// available at a given moment on exactly one `(arm, task)` cell. It parses the
// selection, resolves live host access through gitea-axi's own credential path,
// resolves the scored suite against the host's self-review support, and drives the
// run loop (run-loop.ts) — which in turn drives the single-cell runner and the
// append-only sample store built in earlier slices. No orchestration is
// reimplemented here.
//
// The command is bench-internal (bench/ is excluded from the published package)
// and is executed with a TypeScript-aware runner; see `npm run bench:run`.
//
// The argument parser (`parseRunArgs`) is the pure, unit-tested seam. The live
// wiring in `runBenchCommand` is a live boundary — it resolves real credentials
// and drives the real host and Agent SDK — so, like the seed and runner smoke
// tiers, it is validated by running it rather than by mocked unit tests.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CliDeps } from "../src/deps.js";
import { liveBenchHost } from "./host.js";
import type { Arm } from "./result.js";
import { DEFAULT_TRIALS, REPORTING_FLOOR, runCells, type RunCellsResult } from "./run-loop.js";
import { resolveBenchAccess } from "./seed.js";
import { detectSelfReviewSupport } from "./self-review.js";
import { sdkAgentDriver } from "./sdk-driver.js";
import { createSampleStore, DEFAULT_STORE_ROOT } from "./store.js";
import { buildScoredSuite } from "./task-suite.js";

// Re-exported so this command's existing importers keep resolving it from here;
// its single source of truth is now the store, which owns the default root.
export { DEFAULT_STORE_ROOT };

/** The default turn cap a run is bounded by when not overridden. */
export const DEFAULT_TURN_CAP = 40;

/** The default wall-clock backstop (ms) a run is bounded by when not overridden. */
export const DEFAULT_WALL_CLOCK_MS = 300_000;

/** Environment variable naming the tea login the benchmark authenticates through. */
export const LOGIN_ENV = "GITEA_AXI_BENCH_LOGIN";

/** The four arms a cell may select. */
export const ARMS: readonly Arm[] = ["gitea-axi", "tea", "gitea-mcp", "raw-api"];

/** A fully-resolved cell selection and run configuration. */
export interface RunArgs {
  arm: Arm;
  taskId: string;
  /** Trials to run this sitting; defaults to {@link DEFAULT_TRIALS}. */
  trials: number;
  /** The tea login the benchmark authenticates through. */
  login: string;
  turnCap: number;
  wallClockMs: number;
  storeRoot: string;
}

/** The parse outcome: a request for help, or a resolved configuration to run. */
export type ParsedRunArgs = { help: true } | ({ help: false } & RunArgs);

/** The value-taking flags the command understands; anything else is rejected. */
const KNOWN_FLAGS = new Set([
  "arm",
  "task",
  "trials",
  "login",
  "turn-cap",
  "wall-clock-ms",
  "store",
]);

/** A usage error, surfaced to the maintainer with the offending detail. */
function usage(detail: string): Error {
  return new Error(`${detail}\n\nUsage: bench:run --arm <arm> --task <task-id> [--login <name>] [--trials <n>]`);
}

/** Parse a flag's value as a positive integer, rejecting anything else. */
function positiveInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw usage(`--${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

/**
 * Parse the run-loop command's argv into a resolved configuration, applying
 * defaults ({@link DEFAULT_TRIALS} trials, {@link DEFAULT_TURN_CAP} turn cap,
 * {@link DEFAULT_WALL_CLOCK_MS} backstop, {@link DEFAULT_STORE_ROOT} store, and the
 * login from {@link LOGIN_ENV}). Throws a usage error when a required selection is
 * missing or a value is malformed.
 */
export function parseRunArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): ParsedRunArgs {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "--help" || token === "-h") {
      return { help: true };
    }
    if (!token.startsWith("--")) {
      throw usage(`unexpected argument "${token}"`);
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (!KNOWN_FLAGS.has(name)) {
      throw usage(`unknown flag "--${name}"`);
    }
    let value: string | undefined;
    if (equals === -1) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw usage(`flag --${name} needs a value`);
      }
      index += 1;
    } else {
      value = token.slice(equals + 1);
    }
    flags.set(name, value);
  }

  const arm = flags.get("arm");
  if (arm === undefined) {
    throw usage("--arm <arm> is required");
  }
  if (!ARMS.includes(arm as Arm)) {
    throw usage(`--arm must be one of ${ARMS.join(", ")}, got "${arm}"`);
  }
  const taskId = flags.get("task");
  if (taskId === undefined) {
    throw usage("--task <task-id> is required");
  }
  const login = flags.get("login") ?? env[LOGIN_ENV];
  if (login === undefined || login.length === 0) {
    throw usage(`--login <name> is required (or set ${LOGIN_ENV})`);
  }

  const trials = flags.has("trials") ? positiveInt(flags.get("trials") as string, "trials") : DEFAULT_TRIALS;
  const turnCap = flags.has("turn-cap")
    ? positiveInt(flags.get("turn-cap") as string, "turn-cap")
    : DEFAULT_TURN_CAP;
  const wallClockMs = flags.has("wall-clock-ms")
    ? positiveInt(flags.get("wall-clock-ms") as string, "wall-clock-ms")
    : DEFAULT_WALL_CLOCK_MS;

  return {
    help: false,
    arm: arm as Arm,
    taskId,
    trials,
    login,
    turnCap,
    wallClockMs,
    storeRoot: flags.get("store") ?? DEFAULT_STORE_ROOT,
  };
}

/** The help text printed for `--help` / `-h`. */
const HELP_TEXT = `bench:run — run one benchmark cell on demand.

Runs a single (arm, task) cell for a batch of trials against the live Gitea host,
appending each scored sample to the store. Re-running a cell deepens it: new trials
append rather than overwrite, so a cell's sample size can be grown across sittings.

Usage:
  npm run bench:run -- --arm <arm> --task <task-id> [options]

Required:
  --arm <arm>          One of: ${ARMS.join(", ")}
  --task <task-id>     A scored-suite task id (an unknown id prints the available ids)

Options:
  --login <name>       tea login to authenticate through (default: $${LOGIN_ENV})
  --trials <n>         Trials to run this sitting (default: ${DEFAULT_TRIALS})
  --turn-cap <n>       Per-run turn cap (default: ${DEFAULT_TURN_CAP})
  --wall-clock-ms <n>  Per-run wall-clock backstop in ms (default: ${DEFAULT_WALL_CLOCK_MS})
  --store <dir>        Sample store root (default: ${DEFAULT_STORE_ROOT})
  -h, --help           Show this help`;

/** Render the run-loop tally into the lines printed after a sitting. */
function summarize(result: RunCellsResult, storeRoot: string): string[] {
  const floorNote = result.meetsFloor
    ? `meets the reporting floor of ${REPORTING_FLOOR}`
    : `below the reporting floor of ${REPORTING_FLOOR} — deepen this cell before reporting`;
  return [
    `Cell (${result.arm}, ${result.taskId}): ${result.recorded} recorded, ${result.invalid} invalid this sitting.`,
    `Samples: ${result.priorSamples} → ${result.totalSamples} (${floorNote}).`,
    `Store: ${storeRoot}`,
  ];
}

/**
 * Run one chosen cell on demand: resolve live host access, resolve the scored
 * suite against the host's self-review support, select the task, and drive the run
 * loop. This is the command's live boundary — it authenticates and drives the real
 * host and Agent SDK — so it is validated by running it, not by mocked unit tests
 * (the pure `parseRunArgs` seam is the unit-tested part). Returns a process exit
 * code and prints progress and the final tally through `out`.
 */
export async function runBenchCommand(
  argv: string[],
  deps: CliDeps,
  out: (line: string) => void,
): Promise<number> {
  const parsed = parseRunArgs(argv, deps.env);
  if (parsed.help) {
    out(HELP_TEXT);
    return 0;
  }

  const access = await resolveBenchAccess(deps, parsed.login);

  // The two review tasks are approve/request-changes or comment reviews depending
  // on what the host permits, so the suite is resolved against a live probe once
  // before selecting the task (see task-suite.ts and self-review.ts).
  out(`Probing self-review support on ${new URL(access.apiUrl).host}…`);
  const selfReviewPermitted = await detectSelfReviewSupport(access);
  const suite = buildScoredSuite({ selfReviewPermitted });
  const task = suite.find((candidate) => candidate.id === parsed.taskId);
  if (task === undefined) {
    out(`No scored task with id "${parsed.taskId}". Available task ids:`);
    for (const candidate of suite) {
      out(`  ${candidate.id}  (${candidate.tier})`);
    }
    return 1;
  }

  const store = createSampleStore(parsed.storeRoot);
  const binRoot = mkdtempSync(join(tmpdir(), "bench-run-bin-"));
  out(`Running ${parsed.trials} trial(s) of cell (${parsed.arm}, ${task.id})…`);
  try {
    const result = await runCells({
      arm: parsed.arm,
      task,
      trials: parsed.trials,
      access,
      host: liveBenchHost(access),
      // Every arm runs on the driver's single fixed model per the spec, so the
      // comparison measures the tool rather than the model; the command exposes
      // no per-cell model override that could break that invariant.
      driver: sdkAgentDriver(),
      store,
      bounds: { turnCap: parsed.turnCap, wallClockMs: parsed.wallClockMs },
      build: { binRoot },
    });
    for (const line of summarize(result, parsed.storeRoot)) {
      out(line);
    }
    return 0;
  } finally {
    rmSync(binRoot, { recursive: true, force: true });
  }
}

/** Entry point: parse argv, run the command, and set the process exit code. */
export async function main(): Promise<void> {
  const deps: CliDeps = { env: process.env, cwd: process.cwd(), globals: {} };
  try {
    process.exitCode = await runBenchCommand(
      process.argv.slice(2),
      deps,
      (line) => process.stdout.write(`${line}\n`),
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (e.g. `tsx bench/run.ts`), not when imported by
// a test. Under a TypeScript runner argv[1] is this file's own path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
