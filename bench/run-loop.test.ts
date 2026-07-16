import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResultRecord } from "./result.js";
import { runCells } from "./run-loop.js";
import type {
  AgentDriver,
  BenchHost,
  RunBounds,
  RunCellInput,
} from "./runner.js";
import type { BenchAccess } from "./seed.js";
import { createSampleStore } from "./store.js";
import { SAMPLE_TASK } from "./task.js";

// Trivial stubs for the collaborators the run loop merely forwards to the
// injected single-cell runner. Because runOne is faked below, none of these is
// ever touched, so bare casts are enough to satisfy the input shape.
const ACCESS: BenchAccess = { apiUrl: "https://git.example.test", token: "tok" };
const HOST = {} as BenchHost;
const DRIVER = {} as AgentDriver;
const BOUNDS: RunBounds = { turnCap: 10, wallClockMs: 60_000 };
const BUILD = { binRoot: "/nonexistent" };

/** A minimal recorded ResultRecord the fake runOne returns per trial. */
function record(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    arm: "gitea-axi",
    taskId: SAMPLE_TASK.id,
    tier: SAMPLE_TASK.tier,
    trial: 1,
    timestamp: "2026-07-16T00:00:00Z",
    tokens: { freshInput: 1, cacheCreation: 0, cacheRead: 0, output: 1 },
    turns: 1,
    durationMs: 1,
    imputedCostUsd: 0.01,
    outcome: { pass: true },
    ...overrides,
  };
}

describe("runCells", () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "bench-run-loop-"));
  });

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  // Behavior: with no trials count given, the run loop runs the selected
  // (arm, task) cell for the default of five trials, invoking the injected
  // single-cell runner once per trial with the cell's arm and task. The default
  // of five is an independent literal fixed by the benchmark-harness spec / task
  // 0029 ("Each cell defaults to five trials"), not recomputed from run-loop.ts.
  it("runs the default of five trials when no trials count is given, once per trial with the cell's arm and task", async () => {
    const store = createSampleStore(storeRoot);
    const calls: RunCellInput[] = [];

    const runOne = async (input: RunCellInput) => {
      calls.push(input);
      const rec = record({ trial: input.trial });
      input.store.append(rec);
      return { kind: "recorded", record: rec } as const;
    };

    await runCells({
      arm: "gitea-axi",
      task: SAMPLE_TASK,
      access: ACCESS,
      host: HOST,
      driver: DRIVER,
      store,
      bounds: BOUNDS,
      build: BUILD,
      runOne,
    });

    // Exactly five invocations — the spec's default cell depth.
    expect(calls).toHaveLength(5);

    // Every invocation ran the selected cell's arm and task.
    for (const call of calls) {
      expect(call.arm).toBe("gitea-axi");
      expect(call.task.id).toBe(SAMPLE_TASK.id);
    }
  });

  // Behavior: re-running an already-sampled cell deepens it — the new trials are
  // numbered past the highest trial the cell already holds and are appended, so
  // prior samples are never overwritten (benchmark-harness spec / task 0029). A
  // cell holding 2 samples at trials 1 and 2, run for 3 more trials, must end with
  // 5 samples at trials [1,2,3,4,5]: the first two unchanged, three appended at
  // 3, 4, 5. The trial sequence is an independent literal, not recomputed.
  it("deepens an already-sampled cell, appending new trials past the highest without overwriting priors", async () => {
    const store = createSampleStore(storeRoot);

    // A prior sitting: two samples already accumulated in the cell.
    const prior1 = record({ trial: 1 });
    const prior2 = record({ trial: 2 });
    store.append(prior1);
    store.append(prior2);

    const runOne = async (input: RunCellInput) => {
      const rec = record({ trial: input.trial });
      input.store.append(rec);
      return { kind: "recorded", record: rec } as const;
    };

    const result = await runCells({
      arm: "gitea-axi",
      task: SAMPLE_TASK,
      trials: 3,
      access: ACCESS,
      host: HOST,
      driver: DRIVER,
      store,
      bounds: BOUNDS,
      build: BUILD,
      runOne,
    });

    const samples = store.read({ arm: "gitea-axi", taskId: SAMPLE_TASK.id });

    // The cell deepened from 2 to 5 samples, numbered 1..5 in append order.
    expect(samples).toHaveLength(5);
    expect(samples.map((s) => s.trial)).toEqual([1, 2, 3, 4, 5]);

    // The two prior samples were preserved byte-for-byte, not overwritten.
    expect(samples[0]).toEqual(prior1);
    expect(samples[1]).toEqual(prior2);

    // The result reports how many samples the cell held before and after.
    expect(result.priorSamples).toBe(2);
    expect(result.totalSamples).toBe(5);
  });

  // Behavior: an attempt the single-cell runner flags invalid produces no sample
  // and is tallied separately; a cell only meets the reporting floor once it holds
  // at least three samples (benchmark-harness spec / task 0029, "the reporting
  // floor of three"). Here 2 of 5 attempts record and 3 are flagged invalid (a
  // foreign tool was reached), so the store gains only the 2 recorded samples, the
  // invalid count is tracked apart, and 2 < 3 leaves the cell below the floor. The
  // literals 2, 3, and false come from this worked example, not from run-loop.ts.
  it("tallies invalid attempts apart from recorded samples and stays below the reporting floor at two samples", async () => {
    const store = createSampleStore(storeRoot);

    // Record on the first two attempts, flag the rest invalid without appending.
    let call = 0;
    const runOne = async (input: RunCellInput) => {
      call += 1;
      if (call <= 2) {
        const rec = record({ trial: input.trial });
        input.store.append(rec);
        return { kind: "recorded", record: rec } as const;
      }
      const leaks: string[] = ["curl"];
      return { kind: "invalid" as const, leaks };
    };

    const result = await runCells({
      arm: "gitea-axi",
      task: SAMPLE_TASK,
      trials: 5,
      access: ACCESS,
      host: HOST,
      driver: DRIVER,
      store,
      bounds: BOUNDS,
      build: BUILD,
      runOne,
    });

    // Recorded and invalid attempts are tallied separately.
    expect(result.recorded).toBe(2);
    expect(result.invalid).toBe(3);

    // Only the two recorded attempts became samples; invalid attempts left none.
    expect(result.totalSamples).toBe(2);
    expect(store.read({ arm: "gitea-axi", taskId: SAMPLE_TASK.id })).toHaveLength(2);

    // Two samples is below the reporting floor of three.
    expect(result.meetsFloor).toBe(false);
  });
});
