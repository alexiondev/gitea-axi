// The run loop: the maintainer-facing orchestration that runs one chosen
// `(arm, task)` cell for a batch of trials on demand, so only the token budget
// available at that moment is spent. It drives the single-cell runner (runner.ts)
// and the append-only sample store (store.ts) built in earlier slices rather than
// reimplementing any orchestration — its whole job is to decide how many trials to
// run and at what trial numbers, then leave provisioning, running, scoring, and
// appending to `runCell`.
//
// Because results are immutable timestamped samples, running a cell that already
// has samples deepens it: the new trials continue past the highest trial the cell
// holds and append, so a cell's sample size can be grown opportunistically across
// separate sittings. Each cell defaults to five trials with a reporting floor of
// three; the loop reports whether the cell now meets that floor.

import type { BuildArmOptions } from "./arm.js";
import type { Arm } from "./result.js";
import { runCell, type CellOutcome, type RunBounds, type RunCellInput, type RunnerClock } from "./runner.js";
import type { BenchAccess } from "./seed.js";
import type { SampleStore } from "./store.js";
import type { BenchTask } from "./task.js";

/** A cell defaults to five trials per sitting. */
export const DEFAULT_TRIALS = 5;

/** A cell is only reported once it holds at least this many samples. */
export const REPORTING_FLOOR = 3;

/** Everything needed to run a batch of trials for one `(arm, task)` cell. */
export interface RunCellsInput {
  arm: Arm;
  task: BenchTask;
  /** Trials to run this sitting; defaults to {@link DEFAULT_TRIALS}. */
  trials?: number;
  access: BenchAccess;
  host: RunCellInput["host"];
  driver: RunCellInput["driver"];
  store: SampleStore;
  bounds: RunBounds;
  build: BuildArmOptions;
  clock?: Partial<RunnerClock>;
  /** The single-cell runner; injectable for tests. Defaults to {@link runCell}. */
  runOne?: (input: RunCellInput) => Promise<CellOutcome>;
}

/** The tally of running one batch of trials for a cell. */
export interface RunCellsResult {
  arm: Arm;
  taskId: string;
  /** Per-attempt outcomes in run order. */
  outcomes: CellOutcome[];
  /** Attempts that produced a scored sample this sitting. */
  recorded: number;
  /** Attempts flagged invalid (a foreign tool was reached) this sitting; not sampled. */
  invalid: number;
  /** Samples the cell held before this sitting. */
  priorSamples: number;
  /** Samples the cell holds after this sitting. */
  totalSamples: number;
  /** Whether the cell now meets the reporting floor of {@link REPORTING_FLOOR} samples. */
  meetsFloor: boolean;
}

/**
 * Run a batch of trials for one cell. Deepens the cell if it already has samples:
 * trial numbering continues past the highest existing trial, and every scored
 * sample is appended by `runCell` rather than overwriting a slot.
 */
export async function runCells(input: RunCellsInput): Promise<RunCellsResult> {
  const { arm, task, access, host, driver, store, bounds, build, clock } = input;
  const runOne = input.runOne ?? runCell;
  const trials = input.trials ?? DEFAULT_TRIALS;
  const cell = { arm, taskId: task.id };

  const prior = store.read(cell);
  // Continue numbering past the highest trial the cell already holds so a
  // deepening sitting never reuses a trial number, even if earlier attempts were
  // flagged invalid and left gaps (an invalid attempt records no sample).
  const highestTrial = prior.reduce((max, sample) => Math.max(max, sample.trial), 0);

  const outcomes: CellOutcome[] = [];
  for (let offset = 0; offset < trials; offset += 1) {
    outcomes.push(
      await runOne({
        arm,
        task,
        trial: highestTrial + offset + 1,
        access,
        host,
        driver,
        store,
        bounds,
        build,
        clock,
      }),
    );
  }

  const totalSamples = store.read(cell).length;
  return {
    arm,
    taskId: task.id,
    outcomes,
    recorded: outcomes.filter((outcome) => outcome.kind === "recorded").length,
    invalid: outcomes.filter((outcome) => outcome.kind === "invalid").length,
    priorSamples: prior.length,
    totalSamples,
    meetsFloor: totalSamples >= REPORTING_FLOOR,
  };
}
