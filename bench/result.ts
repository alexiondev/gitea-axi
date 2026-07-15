// The immutable result-record shape that the whole benchmark harness reads and
// writes. One record captures one completed `(arm, task, trial)` run. Records
// are never mutated after they are written; deepening a cell's sample size
// appends new records rather than overwriting prior ones (see store.ts).
//
// The benchmark's own vocabulary (arm, cell, tier, cost-equivalent tokens) is
// documented in bench/README.md and the benchmark-harness spec, deliberately
// kept out of the tool's own domain glossary.

/** The four tool conditions the benchmark compares. */
export type Arm = "gitea-axi" | "tea" | "gitea-mcp" | "raw-api";

/**
 * The task tiers the scored suite is weighted across. Views group by tier to
 * show where an arm wins or loses.
 */
export type Tier = "read" | "single-mutation" | "find-then-act" | "multi-step";

/**
 * The four token components retained per run. They are kept separate (rather
 * than pre-summed) so cost-equivalent tokens can be re-weighted at render time
 * without re-running — see the cost-equivalent-token-metric ADR. The auxiliary
 * small model the runtime invokes for internal chores is folded into these
 * counts, because it is real consumption against the same allowance.
 */
export interface TokenComponents {
  /** Fresh, uncached input tokens (weighted 1x). */
  freshInput: number;
  /** Cache-creation (write) tokens. */
  cacheCreation: number;
  /** Cache-read tokens. */
  cacheRead: number;
  /** Output tokens. */
  output: number;
}

/**
 * Why a run failed. `incorrect` means the agent finished but the checker scored
 * the outcome wrong; `confused` means it hit the turn cap; `hung` means it hit
 * the wall-clock backstop. The confused-versus-hung split lets the reporting
 * distinguish a lost agent from a stuck one.
 */
export type FailureTag = "incorrect" | "confused" | "hung";

/** The pass/fail outcome of a run, tagged with the failure mode when it fails. */
export type Outcome = { pass: true } | { pass: false; failure: FailureTag };

/**
 * One completed `(arm, task, trial)` run. Carries the metrics the headline and
 * supporting views are computed from, plus the tags those views group by.
 */
export interface ResultRecord {
  /** The arm under test. */
  arm: Arm;
  /** The task's stable identifier. */
  taskId: string;
  /** The task's tier. */
  tier: Tier;
  /** The trial index within the cell (1-based). */
  trial: number;
  /** ISO 8601 timestamp of when the sample was recorded. */
  timestamp: string;

  /** The four token components. */
  tokens: TokenComponents;
  /** Number of agent turns the run took. */
  turns: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** The runtime's imputed cost in US dollars, retained as a secondary metric. */
  imputedCostUsd: number;

  /** Pass/fail outcome with a failure tag. */
  outcome: Outcome;
}

/**
 * The address of a cell in the sample store. A cell is one `(arm, task)` pair;
 * its trials accumulate as samples within it.
 */
export interface CellKey {
  arm: Arm;
  taskId: string;
}
