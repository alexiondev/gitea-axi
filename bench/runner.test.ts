import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoState } from "./scoring-spec.js";
import type { BenchAccess, RepoCoords } from "./seed.js";
import { groundTruth } from "./seed-plan.js";
import { createSampleStore } from "./store.js";
import { SAMPLE_TASK } from "./task.js";
import type { AgentDriver, BenchHost } from "./runner.js";
import { runCell } from "./runner.js";

// The user the fake seed/capture are parametrized by; a single independent
// literal, echoed into the passing capture below.
const USER = "benchbot";

// The fixed coordinates the fake host provisions. Independent literals so the
// delete-with-these-coords assertion is unambiguous.
const COORDS: RepoCoords = { owner: USER, repo: "bench-1" };

const ACCESS: BenchAccess = { apiUrl: "https://git.example.test", token: "tok" };

// The passing post-run state IS the task's own expected end state, so the
// checker scores it a legitimate pass. Built from the task, not from runner.ts.
const spec = SAMPLE_TASK.scoringSpec(USER);
const passingState: RepoState = spec.kind === "mutation" ? spec.expected : groundTruth(USER);

// The four token components, turns, and imputed cost are independent literals
// planted in the fake driver; the recorded sample must carry them back unchanged.
const DRIVER_TOKENS = { freshInput: 100, cacheCreation: 20, cacheRead: 300, output: 40 };
const DRIVER_TURNS = 5;
const DRIVER_COST = 0.12;

/** A fake host recording which methods were called and with what coords. */
function createFakeHost() {
  const calls = {
    provisioned: false,
    seeded: false,
    captured: false,
    deletedCoords: null as RepoCoords | null,
  };
  const host: BenchHost = {
    async provision() {
      calls.provisioned = true;
      return COORDS;
    },
    async seed(coords) {
      calls.seeded = true;
      return groundTruth(coords.owner);
    },
    async capture() {
      calls.captured = true;
      return passingState;
    },
    async delete(coords) {
      calls.deletedCoords = coords;
    },
  };
  return { host, calls };
}

/**
 * A fake host whose `capture` returns the UNMUTATED seed — the target issue "Add
 * CSV export option" is still OPEN, so the task's spec (which expects it CLOSED)
 * is not satisfied and the checker scores the run incorrect. Everything else
 * matches createFakeHost. Records the deleted coords for the cleanup assertion.
 */
function createUnmutatedHost() {
  const calls = { deletedCoords: null as RepoCoords | null };
  const host: BenchHost = {
    async provision() {
      return COORDS;
    },
    async seed(coords) {
      return groundTruth(coords.owner);
    },
    async capture(coords) {
      return groundTruth(coords.owner);
    },
    async delete(coords) {
      calls.deletedCoords = coords;
    },
  };
  return { host, calls };
}

/** A fake driver that resolves immediately with the planted metrics. */
const driver: AgentDriver = {
  async run() {
    return {
      tokens: DRIVER_TOKENS,
      turns: DRIVER_TURNS,
      imputedCostUsd: DRIVER_COST,
      transcript: [{ kind: "mcp", server: "gitea-mcp", tool: "edit_issue" }],
      finalReport: "Closed the issue.",
      stoppedByTurnCap: false,
    };
  },
};

/**
 * A fake driver that completes cleanly (not turn-capped, clean MCP transcript
 * that audits clean on the gitea-mcp arm). Paired with the unmutated host, the
 * run finishes but the checker scores it incorrect.
 */
const cleanDriver: AgentDriver = {
  async run() {
    return {
      tokens: { freshInput: 50, cacheCreation: 0, cacheRead: 0, output: 10 },
      turns: 2,
      imputedCostUsd: 0.03,
      transcript: [{ kind: "mcp", server: "gitea-mcp", tool: "list_repo_issues" }],
      finalReport: "Done.",
      stoppedByTurnCap: false,
    };
  },
};

/**
 * A fake driver reporting it hit the turn cap (`stoppedByTurnCap: true`). The
 * other fields are arbitrary-but-valid literals; the run should be recorded as a
 * confused failure regardless of them.
 */
const turnCappedDriver: AgentDriver = {
  async run() {
    return {
      tokens: { freshInput: 10, cacheCreation: 0, cacheRead: 0, output: 5 },
      turns: 10,
      imputedCostUsd: 0.02,
      transcript: [],
      finalReport: "",
      stoppedByTurnCap: true,
    };
  },
};

/**
 * A fake driver that never resolves on its own — it settles only when its abort
 * signal fires. Paired with a clock whose backstop timer fires first, it models a
 * run that hangs past the wall-clock bound: the runner aborts the signal, and the
 * driver then settles so no forever-pending promise is leaked.
 */
const hangingDriver: AgentDriver = {
  run: ({ signal }) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () =>
        resolve({
          tokens: { freshInput: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
          turns: 0,
          imputedCostUsd: 0,
          transcript: [],
          finalReport: "",
          stoppedByTurnCap: false,
        }),
      );
    }),
};

/**
 * A fake driver whose transcript reaches the shell on the shell-disabled
 * gitea-mcp arm — a foreign-tool leak per the audit's contract (proven in
 * bench/audit.test.ts). The post-run audit should flag this cell invalid.
 */
const leakingDriver: AgentDriver = {
  async run() {
    return {
      tokens: { freshInput: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
      turns: 1,
      imputedCostUsd: 0,
      transcript: [{ kind: "shell", command: "curl https://git.example.test/api/v1/repos" }],
      finalReport: "",
      stoppedByTurnCap: false,
    };
  },
};

describe("runCell", () => {
  let binRoot: string;
  let storeRoot: string;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), "bench-runner-bin-"));
    storeRoot = mkdtempSync(join(tmpdir(), "bench-runner-"));
  });

  afterEach(() => {
    rmSync(binRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  });

  // Behavior: running one cell on the happy path provisions and seeds a fresh
  // repository, runs the agent under its arm, captures the post-run snapshot and
  // scores it (a PASS here, because the fake capture returns the task's own
  // expected end state), appends exactly one sample carrying the driver's four
  // token components / turns / imputed cost and a passing outcome, and deletes
  // the repository afterward (benchmark-harness spec, runner tracer bullet). The
  // gitea-mcp arm needs no host binaries and its MCP transcript audits clean.
  it("provisions, seeds, runs, scores a pass, records one sample, and deletes the repo", async () => {
    const { host, calls } = createFakeHost();
    const store = createSampleStore(storeRoot);
    const trial = 3;

    const outcome = await runCell({
      arm: "gitea-mcp",
      task: SAMPLE_TASK,
      trial,
      access: ACCESS,
      host,
      driver,
      store,
      bounds: { turnCap: 10, wallClockMs: 60_000 },
      build: { binRoot },
    });

    // The lifecycle ran end to end, deleting exactly the provisioned repo.
    expect(calls.provisioned).toBe(true);
    expect(calls.seeded).toBe(true);
    expect(calls.captured).toBe(true);
    expect(calls.deletedCoords).toEqual(COORDS);

    // runCell resolves to a recorded outcome (not invalid).
    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    // Exactly one sample landed in this cell, carrying the driver's metrics
    // unchanged, the task's coordinates, the trial passed in, and a passing outcome.
    const samples = store.read({ arm: "gitea-mcp", taskId: SAMPLE_TASK.id });
    expect(samples).toHaveLength(1);
    const [sample] = samples;
    expect(sample).toBeDefined();
    if (sample === undefined) return;

    expect(sample.arm).toBe("gitea-mcp");
    expect(sample.taskId).toBe(SAMPLE_TASK.id);
    expect(sample.tier).toBe(SAMPLE_TASK.tier);
    expect(sample.trial).toBe(trial);

    expect(sample.tokens).toEqual(DRIVER_TOKENS);
    expect(sample.turns).toBe(DRIVER_TURNS);
    expect(sample.imputedCostUsd).toBe(DRIVER_COST);
    expect(sample.outcome).toEqual({ pass: true });

    // The sample carries the run's wall-clock duration; a completed run takes
    // non-negative time.
    expect(typeof sample.durationMs).toBe("number");
    expect(sample.durationMs).toBeGreaterThanOrEqual(0);

    // The returned record is the same sample that was stored.
    expect(outcome.record).toEqual(sample);
  });

  // Behavior: the run is bounded by a turn cap, and a run that hit it records a
  // failure tagged confused (benchmark-harness spec, "confused-versus-hung"). The
  // driver reports the cap was hit via stoppedByTurnCap: true, so the recorded
  // sample's outcome must be { pass: false, failure: "confused" } — the failed
  // outcome shape and the "confused" tag are independent literals fixed by
  // result.ts's Outcome/FailureTag contract, not recomputed from runner.ts. Still
  // exactly one sample lands and runCell resolves to a recorded outcome.
  it("records a confused failure when the run hits the turn cap", async () => {
    const { host } = createFakeHost();
    const store = createSampleStore(storeRoot);

    const outcome = await runCell({
      arm: "gitea-mcp",
      task: SAMPLE_TASK,
      trial: 1,
      access: ACCESS,
      host,
      driver: turnCappedDriver,
      store,
      bounds: { turnCap: 10, wallClockMs: 60_000 },
      build: { binRoot },
    });

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    const samples = store.read({ arm: "gitea-mcp", taskId: SAMPLE_TASK.id });
    expect(samples).toHaveLength(1);
    const [sample] = samples;
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    expect(sample.outcome).toEqual({ pass: false, failure: "confused" });
  });

  // Behavior: the run is also bounded by a wall-clock backstop, and a run that
  // exceeds it records a failure tagged hung (benchmark-harness spec,
  // "confused-versus-hung"). An injected clock fires the backstop timer before the
  // (never-self-resolving) driver finishes; the runner aborts the signal, which
  // lets the driver settle. The recorded sample's outcome must be
  // { pass: false, failure: "hung" } — a hung outcome is an independent literal
  // fixed by result.ts's Outcome/FailureTag contract, not recomputed from
  // runner.ts. Still exactly one sample lands and runCell resolves to recorded.
  it("records a hung failure when the run exceeds the wall-clock backstop", async () => {
    const { host } = createFakeHost();
    const store = createSampleStore(storeRoot);

    // Fire the backstop timer promptly (0ms) with a real clearable handle, so the
    // wall-clock bound trips before the hanging driver would ever resolve.
    const clock = {
      setTimer: (_ms: number, fn: () => void) => {
        const h = setTimeout(fn, 0);
        return { clear: () => clearTimeout(h) };
      },
    };

    const outcome = await runCell({
      arm: "gitea-mcp",
      task: SAMPLE_TASK,
      trial: 1,
      access: ACCESS,
      host,
      driver: hangingDriver,
      store,
      bounds: { turnCap: 10, wallClockMs: 50 },
      build: { binRoot },
      clock,
    });

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    const samples = store.read({ arm: "gitea-mcp", taskId: SAMPLE_TASK.id });
    expect(samples).toHaveLength(1);
    const [sample] = samples;
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    expect(sample.outcome).toEqual({ pass: false, failure: "hung" });
  });

  // Behavior: a transcript audit runs after each cell, and a run in which a
  // foreign tool was reached is flagged invalid instead of scored (benchmark-
  // harness spec, "Tool isolation"). Here the gitea-mcp arm (shell disabled) has a
  // shell command in its transcript — a leak by the audit's contract (proven in
  // bench/audit.test.ts). So runCell must yield { kind: "invalid", leaks } with a
  // non-empty leaks array, append NO sample (the store stays empty), and still
  // delete the provisioned repo. These come from the CellOutcome contract and the
  // spec's "invalid instead of scored", not from runner.ts's internals.
  it("flags the cell invalid without scoring when the transcript reaches a foreign tool, still deleting the repo", async () => {
    const { host, calls } = createFakeHost();
    const store = createSampleStore(storeRoot);

    const outcome = await runCell({
      arm: "gitea-mcp",
      task: SAMPLE_TASK,
      trial: 1,
      access: ACCESS,
      host,
      driver: leakingDriver,
      store,
      bounds: { turnCap: 10, wallClockMs: 60_000 },
      build: { binRoot },
    });

    // Invalid instead of scored: a non-empty leaks array, and no sample appended.
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind !== "invalid") return;
    expect(outcome.leaks.length).toBeGreaterThan(0);

    expect(store.read({ arm: "gitea-mcp", taskId: SAMPLE_TASK.id })).toHaveLength(0);

    // Cleanup still happens: the provisioned repo is deleted.
    expect(calls.deletedCoords).toEqual(COORDS);
  });

  // Behavior: the recorded sample carries the checker's pass/fail outcome, and a
  // run that finished cleanly (not turn-capped, no leak) but whose post-run
  // snapshot does not satisfy the task's scoring spec is scored a failure tagged
  // incorrect (benchmark-harness spec; result.ts's FailureTag). The unmutated host
  // returns the seed state where the target issue is still OPEN, but the task's
  // spec expects it CLOSED, so the checker's full-state diff fails. The expected
  // outcome { pass: false, failure: "incorrect" } is an independent literal from
  // result.ts's contract, not recomputed from runner.ts.
  it("records an incorrect failure when a clean run's snapshot does not satisfy the scoring spec", async () => {
    const { host } = createUnmutatedHost();
    const store = createSampleStore(storeRoot);

    const outcome = await runCell({
      arm: "gitea-mcp",
      task: SAMPLE_TASK,
      trial: 1,
      access: ACCESS,
      host,
      driver: cleanDriver,
      store,
      bounds: { turnCap: 10, wallClockMs: 60_000 },
      build: { binRoot },
    });

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;

    const samples = store.read({ arm: "gitea-mcp", taskId: SAMPLE_TASK.id });
    expect(samples).toHaveLength(1);
    const [sample] = samples;
    expect(sample).toBeDefined();
    if (sample === undefined) return;
    expect(sample.outcome).toEqual({ pass: false, failure: "incorrect" });
  });
});
