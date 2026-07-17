// The single-cell runner: the tracer bullet that threads every layer to run one
// `(arm, task, trial)` cell end to end and record an immutable result. It
// provisions and seeds a fresh throwaway repository, runs the agent under exactly
// the active arm's tool with the guard active, bounds the run by a turn cap and a
// wall-clock backstop, captures and scores the post-run state, appends the result
// sample to the store, and deletes the repository — auditing the transcript so a
// run that reached a foreign tool is flagged invalid rather than scored.
//
// The two boundaries the runner cannot make deterministic — the live host and the
// Claude Agent SDK — are factored behind the `BenchHost` and `AgentDriver` seams,
// so the orchestration here is unit-tested with fakes while the live wiring is
// validated by a smoke run (runner.smoke.test.ts), mirroring the seed tier.

import { buildArm, type ArmDefinition, type BuildArmOptions, type SharedContext } from "./arm.js";
import { auditTranscript, type ToolUse } from "./audit.js";
import { score } from "./checker.js";
import type { Arm, Outcome, ResultRecord, TokenComponents } from "./result.js";
import type { RepoState, ScoringSpec } from "./scoring-spec.js";
import type { BenchAccess, RepoCoords } from "./seed.js";
import type { SampleStore } from "./store.js";
import type { BenchTask } from "./task.js";

/**
 * What the agent driver reports from one run: the four token components (folding
 * in the auxiliary small model, per the cost-equivalent-token metric), the turn
 * count, the imputed cost, the transcript for the post-run audit, the agent's
 * final report for read tasks, and whether the run stopped because it hit the
 * turn cap (which the runner tags as a confused failure).
 */
export interface AgentRun {
  tokens: TokenComponents;
  turns: number;
  imputedCostUsd: number;
  transcript: ToolUse[];
  finalReport: string;
  stoppedByTurnCap: boolean;
}

/** The inputs the runner hands the driver for one run. */
export interface AgentRunInput {
  /** The assembled arm (system prompt plus tool/guard or MCP configuration). */
  arm: ArmDefinition;
  /** The task's natural-language intent. */
  intent: string;
  /** The turn cap the driver must enforce, reporting `stoppedByTurnCap`. */
  turnCap: number;
  /** Aborted when the wall-clock backstop fires; the driver must resolve on abort. */
  signal: AbortSignal;
}

/**
 * The agent driver seam. The production implementation drives the Claude Agent
 * SDK on the maintainer's subscription (sdk-driver.ts); tests inject a fake.
 */
export interface AgentDriver {
  run(input: AgentRunInput): Promise<AgentRun>;
}

/**
 * The live-host surface the runner drives, factored out so the orchestration is
 * testable with a fake. The production implementation talks to the real Gitea
 * host (seed.ts and snapshot.ts); its value is the real API interaction, so it is
 * validated by the smoke run rather than mocked.
 */
export interface BenchHost {
  /** Create and return a fresh, empty throwaway repository. */
  provision(): Promise<RepoCoords>;
  /** Seed the repository to the deterministic ground truth. */
  seed(coords: RepoCoords): Promise<RepoState>;
  /** Read the full post-run repository state as a snapshot. */
  capture(coords: RepoCoords): Promise<RepoState>;
  /** Best-effort deletion of the throwaway repository. */
  delete(coords: RepoCoords): Promise<void>;
}

/** The two bounds every run is held within. */
export interface RunBounds {
  /** Maximum agent turns; exceeding it is a confused failure. */
  turnCap: number;
  /** Wall-clock backstop in milliseconds; exceeding it is a hung failure. */
  wallClockMs: number;
}

/**
 * The clock and timer the runner uses, injectable so timing is deterministic in
 * tests. Defaults to real wall-clock time and `setTimeout`.
 */
export interface RunnerClock {
  now: () => number;
  setTimer: (ms: number, fn: () => void) => { clear: () => void };
}

/** Everything needed to run one `(arm, task, trial)` cell. */
export interface RunCellInput {
  arm: Arm;
  task: BenchTask;
  trial: number;
  access: BenchAccess;
  host: BenchHost;
  driver: AgentDriver;
  store: SampleStore;
  bounds: RunBounds;
  build: BuildArmOptions;
  clock?: Partial<RunnerClock>;
}

/**
 * The result of running one cell: either a scored sample was recorded, or the run
 * was flagged invalid — a foreign tool was reached — and left unscored, so it
 * never becomes a sample in the store.
 */
export type CellOutcome =
  | { kind: "recorded"; record: ResultRecord }
  | { kind: "invalid"; leaks: string[] };

const DEFAULT_CLOCK: RunnerClock = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    return { clear: () => clearTimeout(handle) };
  },
};

/** Token components for a run that produced no measurable consumption (a hung run). */
const NO_TOKENS: TokenComponents = { freshInput: 0, cacheCreation: 0, cacheRead: 0, output: 0 };

/**
 * Run one cell end to end. Provisions and seeds a throwaway repository, runs the
 * agent under the arm with a turn cap and a wall-clock backstop, audits the
 * transcript, scores the completed run, appends the sample, and always deletes
 * the repository. Exceeding the turn cap records a confused failure; exceeding the
 * wall-clock backstop records a hung failure; a transcript that reached a foreign
 * tool is flagged invalid rather than scored.
 */
export async function runCell(input: RunCellInput): Promise<CellOutcome> {
  const { arm, task, trial, access, host, driver, store, bounds, build } = input;
  const clock: RunnerClock = { ...DEFAULT_CLOCK, ...input.clock };

  const coords = await host.provision();
  try {
    await host.seed(coords);
    const context: SharedContext = { coords, access };
    const armDef = buildArm(arm, context, build);

    const started = clock.now();
    const result = await runBounded(driver, armDef, task.intent, bounds, clock);
    const durationMs = clock.now() - started;

    // A hung run produced no completed transcript to audit or score; record it
    // as a failure with no measured consumption.
    if (result.kind === "hung") {
      return recorded(
        store,
        makeRecord(input, NO_TOKENS, 0, 0, durationMs, { pass: false, failure: "hung" }, undefined, clock),
      );
    }

    const run = result.run;

    // The post-run audit is authoritative on validity: a reached foreign tool
    // invalidates the trial rather than letting it be scored or recorded.
    const audit = auditTranscript(armDef, run.transcript);
    if (!audit.clean) {
      return { kind: "invalid", leaks: audit.leaks };
    }

    const spec = task.scoringSpec(coords.owner);
    const outcome = run.stoppedByTurnCap
      ? ({ pass: false, failure: "confused" } as const)
      : await scoreRun(host, coords, spec, run);

    // Retain the agent's final report for read tasks so a failed read is
    // diagnosable directly from the record; mutation tasks are scored by diffing
    // repository state and have no agent report to record.
    const report = spec.kind === "read" ? run.finalReport : undefined;

    return recorded(
      store,
      makeRecord(input, run.tokens, run.turns, run.imputedCostUsd, durationMs, outcome, report, clock),
    );
  } finally {
    await host.delete(coords);
  }
}

/** The bounded outcome of driving the agent: it either ran, or the backstop fired. */
type BoundedResult = { kind: "ran"; run: AgentRun } | { kind: "hung" };

/**
 * Drive the agent under the wall-clock backstop. The driver enforces the turn cap
 * itself (reporting `stoppedByTurnCap`); this races it against a timer so a driver
 * that genuinely hangs cannot block the cell forever. When the timer wins, the
 * signal is aborted so a cooperating driver can stop, and the run is hung.
 */
async function runBounded(
  driver: AgentDriver,
  arm: ArmDefinition,
  intent: string,
  bounds: RunBounds,
  clock: RunnerClock,
): Promise<BoundedResult> {
  const controller = new AbortController();
  let timer: { clear: () => void } | undefined;
  const backstop = new Promise<BoundedResult>((resolve) => {
    timer = clock.setTimer(bounds.wallClockMs, () => resolve({ kind: "hung" }));
  });
  try {
    return await Promise.race([
      driver
        .run({ arm, intent, turnCap: bounds.turnCap, signal: controller.signal })
        .then((run) => ({ kind: "ran" as const, run })),
      backstop,
    ]);
  } finally {
    timer?.clear();
    controller.abort();
  }
}

/**
 * Score a completed (not turn-capped) run: capture the post-run snapshot and diff
 * it against the task's expected end state for a mutation, or match the agent's
 * final report against the required facts for a read. A pass is a pass; anything
 * the checker rejects is an incorrect failure.
 */
async function scoreRun(host: BenchHost, coords: RepoCoords, spec: ScoringSpec, run: AgentRun): Promise<Outcome> {
  const snapshot = await host.capture(coords);
  const check =
    spec.kind === "mutation"
      ? score(spec, { kind: "mutation", state: snapshot })
      : score(spec, { kind: "read", report: run.finalReport });
  return check.pass ? { pass: true } : { pass: false, failure: "incorrect" };
}

/** Assemble the immutable result record for one run. */
function makeRecord(
  input: RunCellInput,
  tokens: TokenComponents,
  turns: number,
  imputedCostUsd: number,
  durationMs: number,
  outcome: Outcome,
  report: string | undefined,
  clock: RunnerClock,
): ResultRecord {
  return {
    arm: input.arm,
    taskId: input.task.id,
    tier: input.task.tier,
    trial: input.trial,
    timestamp: new Date(clock.now()).toISOString(),
    tokens,
    turns,
    durationMs,
    imputedCostUsd,
    outcome,
    // Absent for mutation runs and runs with no completed report (hung); JSON
    // serialization drops the key when undefined.
    ...(report !== undefined ? { report } : {}),
  };
}

/** Append the record and return it as the recorded cell outcome. */
function recorded(store: SampleStore, record: ResultRecord): CellOutcome {
  store.append(record);
  return { kind: "recorded", record };
}
