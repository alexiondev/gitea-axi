// The aggregator: the pure seam that renders the accumulated sample store into a
// readable comparison. It reads whatever samples exist and annotates incomplete
// coverage rather than blocking on a complete matrix, so a half-run benchmark
// still produces a non-misleading table.
//
// The headline metric — cost-equivalent tokens — is computed here at render time
// by weighting each run's four retained token components by Anthropic's published
// API pricing ratios (see ADR 0014). Nothing is pre-summed in the stored records,
// so the data can be re-weighted without re-running if the subscription's weekly
// accounting is ever documented.
//
// This module is a pure function of the records plus the task definitions: no I/O
// beyond `readAllSamples`, which drains a sample store into a flat record list.
// Everything else — aggregate and renderReport — is deterministic and unit-tested
// against synthetic sample stores.

import type { Arm, ResultRecord, Tier, TokenComponents } from "./result.js";
import { REPORTING_FLOOR } from "./run-loop.js";
import type { SampleStore } from "./store.js";
import type { BenchTask } from "./task.js";
import type { Applicability, BonusDirection, BonusTask } from "./task-suite.js";

/**
 * The cost-equivalent-token weights, from ADR 0014: fresh input 1×, cache-write
 * 1.25× (the 5-minute-TTL cache-write multiplier — the records retain a single
 * un-TTL'd cache-creation component, so the default write price applies),
 * cache-read 0.1×, output 5×. These are Anthropic's published API pricing ratios;
 * changing the subscription's real accounting means changing only these numbers,
 * since the stored records keep the four components un-weighted.
 */
export const COST_EQUIVALENT_WEIGHTS: Readonly<Record<keyof TokenComponents, number>> = {
  freshInput: 1,
  cacheCreation: 1.25,
  cacheRead: 0.1,
  output: 5,
};

/** The fixed arm display order; every headline and breakdown lists arms in it. */
export const ARM_ORDER: readonly Arm[] = ["gitea-axi", "tea", "gitea-mcp", "raw-api"];

/** The fixed tier display order for the per-tier breakdown. */
export const TIER_ORDER: readonly Tier[] = [
  "read",
  "single-mutation",
  "find-then-act",
  "multi-step",
];

/** Weight one run's four token components into a single cost-equivalent token count. */
export function costEquivalentTokens(tokens: TokenComponents): number {
  return (
    tokens.freshInput * COST_EQUIVALENT_WEIGHTS.freshInput +
    tokens.cacheCreation * COST_EQUIVALENT_WEIGHTS.cacheCreation +
    tokens.cacheRead * COST_EQUIVALENT_WEIGHTS.cacheRead +
    tokens.output * COST_EQUIVALENT_WEIGHTS.output
  );
}

/** Sum one run's four token components at 1× — the raw, assumption-free total. */
export function rawTokens(tokens: TokenComponents): number {
  return tokens.freshInput + tokens.cacheCreation + tokens.cacheRead + tokens.output;
}

/**
 * How much of an arm's slice of the matrix has been run. A cell is one task; it is
 * `covered` once it holds at least the reporting floor of samples, `partial` while
 * it holds fewer, and `missing` while it holds none. The three always sum to
 * `tasksTotal`, so partial and missing coverage is annotated rather than hidden.
 */
export interface Coverage {
  tasksTotal: number;
  covered: number;
  partial: number;
  missing: number;
}

/** One headline row: an arm's per-run means plus its success rate and coverage. */
export interface ArmHeadline {
  arm: Arm;
  /** Samples the arm holds across all its cells. */
  samples: number;
  /** Mean cost-equivalent tokens per run; `null` when the arm has no samples. */
  costEquivalentTokens: number | null;
  /** Mean raw token sum per run; `null` when the arm has no samples. */
  rawTokens: number | null;
  /** Mean turns per run; `null` when the arm has no samples. */
  turns: number | null;
  /** Mean wall-clock duration (ms) per run; `null` when the arm has no samples. */
  durationMs: number | null;
  /** Fraction of runs that passed (0..1); `null` when the arm has no samples. */
  successRate: number | null;
  /** Mean imputed cost (USD) per run; `null` when the arm has no samples. */
  imputedCostUsd: number | null;
  coverage: Coverage;
}

/** One arm's slice of a per-tier breakdown. */
export interface TierArm {
  arm: Arm;
  samples: number;
  costEquivalentTokens: number | null;
  successRate: number | null;
  coverage: Coverage;
}

/** The per-tier breakdown for one tier, one row per arm. */
export interface TierBreakdown {
  tier: Tier;
  arms: TierArm[];
}

/** One arm's mean per-run token component breakdown; `null` fields when no samples. */
export interface ComponentBreakdown {
  arm: Arm;
  freshInput: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
  output: number | null;
}

/** One arm's run metrics for a bonus operation, when any samples exist for it. */
export interface BonusArmSamples {
  arm: Arm;
  samples: number;
  costEquivalentTokens: number | null;
  successRate: number | null;
}

/** One row of the bonus table: a capability-asymmetric operation and its status. */
export interface BonusRow {
  id: string;
  operation: string;
  direction: BonusDirection;
  note: string;
  /** gitea-axi's own applicability for the operation, from the definition. */
  giteaAxi: Applicability;
  /** Per-arm run metrics from the records; usually empty (bonus cells are rarely run). */
  arms: BonusArmSamples[];
}

/** The fully-aggregated report, ready to render. */
export interface Report {
  /** The floor a cell's sample count must reach to count as covered. */
  reportingFloor: number;
  headline: ArmHeadline[];
  tiers: TierBreakdown[];
  components: ComponentBreakdown[];
  bonus: BonusRow[];
}

/**
 * The task facts the aggregator needs to score coverage: an id to key each cell
 * and a tier to group it under. The real scored suite (`BenchTask[]`) satisfies
 * this, but so does a bare `{ id, tier }` list, since the aggregator never scores.
 */
export type TaskCoverage = Pick<BenchTask, "id" | "tier">;

/** Everything the aggregator needs: the samples and the definitions to score coverage against. */
export interface AggregateInput {
  records: readonly ResultRecord[];
  suite: readonly TaskCoverage[];
  bonus: readonly BonusTask[];
  /** Samples a cell needs before it counts as covered; defaults to {@link REPORTING_FLOOR}. */
  reportingFloor?: number;
}

/** Drain every sample the store holds into one flat, append-order record list. */
export function readAllSamples(store: SampleStore): ResultRecord[] {
  return store.cells().flatMap((cell) => store.read(cell));
}

/** The arithmetic mean of a list, or `null` for an empty list (no data to average). */
function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The fraction of runs that passed, or `null` when there are no runs. */
function passRate(records: readonly ResultRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }
  return records.filter((record) => record.outcome.pass).length / records.length;
}

/** Mean cost-equivalent tokens per run over a record set, or `null` when empty. */
function meanCostEquivalent(records: readonly ResultRecord[]): number | null {
  return mean(records.map((record) => costEquivalentTokens(record.tokens)));
}

/**
 * Count how a task set's cells are covered by one arm's records: a cell is
 * `covered` once it holds at least the floor of samples, `partial` below it,
 * `missing` at zero. The three always sum to the task count, so partial and
 * missing coverage is annotated rather than hidden.
 */
function coverageOf(
  tasks: readonly TaskCoverage[],
  armRecords: readonly ResultRecord[],
  floor: number,
): Coverage {
  let covered = 0;
  let partial = 0;
  let missing = 0;
  for (const task of tasks) {
    const count = armRecords.filter((record) => record.taskId === task.id).length;
    if (count >= floor) {
      covered += 1;
    } else if (count > 0) {
      partial += 1;
    } else {
      missing += 1;
    }
  }
  return { tasksTotal: tasks.length, covered, partial, missing };
}

/** Aggregate the records against the task definitions into a renderable report. */
export function aggregate(input: AggregateInput): Report {
  const floor = input.reportingFloor ?? REPORTING_FLOOR;

  const headline = ARM_ORDER.map((arm): ArmHeadline => {
    const armRecords = input.records.filter((record) => record.arm === arm);
    return {
      arm,
      samples: armRecords.length,
      costEquivalentTokens: meanCostEquivalent(armRecords),
      rawTokens: mean(armRecords.map((record) => rawTokens(record.tokens))),
      turns: mean(armRecords.map((record) => record.turns)),
      durationMs: mean(armRecords.map((record) => record.durationMs)),
      successRate: passRate(armRecords),
      imputedCostUsd: mean(armRecords.map((record) => record.imputedCostUsd)),
      coverage: coverageOf(input.suite, armRecords, floor),
    };
  });

  const tiers = TIER_ORDER.map((tier): TierBreakdown => {
    const tierTasks = input.suite.filter((task) => task.tier === tier);
    const tierRecords = input.records.filter((record) => record.tier === tier);
    const arms = ARM_ORDER.map((arm): TierArm => {
      const armRecords = tierRecords.filter((record) => record.arm === arm);
      return {
        arm,
        samples: armRecords.length,
        costEquivalentTokens: meanCostEquivalent(armRecords),
        successRate: passRate(armRecords),
        coverage: coverageOf(tierTasks, armRecords, floor),
      };
    });
    return { tier, arms };
  });

  const components = ARM_ORDER.map((arm): ComponentBreakdown => {
    const armRecords = input.records.filter((record) => record.arm === arm);
    return {
      arm,
      freshInput: mean(armRecords.map((record) => record.tokens.freshInput)),
      cacheCreation: mean(armRecords.map((record) => record.tokens.cacheCreation)),
      cacheRead: mean(armRecords.map((record) => record.tokens.cacheRead)),
      output: mean(armRecords.map((record) => record.tokens.output)),
    };
  });

  const bonus = input.bonus.map((definition): BonusRow => {
    const cellRecords = input.records.filter((record) => record.taskId === definition.id);
    const arms = ARM_ORDER.flatMap((arm): BonusArmSamples[] => {
      const armRecords = cellRecords.filter((record) => record.arm === arm);
      if (armRecords.length === 0) {
        return [];
      }
      return [
        {
          arm,
          samples: armRecords.length,
          costEquivalentTokens: meanCostEquivalent(armRecords),
          successRate: passRate(armRecords),
        },
      ];
    });
    return {
      id: definition.id,
      operation: definition.operation,
      direction: definition.direction,
      note: definition.note,
      giteaAxi: definition.giteaAxi,
      arms,
    };
  });

  return { reportingFloor: floor, headline, tiers, components, bonus };
}

/** Per-column horizontal alignment for the text tables. */
type Align = "left" | "right";

/** Render a value with `format`, or the em-dash placeholder when it is absent. */
function cell(value: number | null, format: (value: number) => string): string {
  return value === null ? "—" : format(value);
}

/** Round to a whole number — the scale token counts are reported at. */
const asInteger = (value: number): string => String(Math.round(value));
/** One decimal place — for the soft turn and (via seconds) duration metrics. */
const asDecimal = (value: number): string => value.toFixed(1);
/** Milliseconds as seconds, since durations are seconds-scale and network-soft. */
const asSeconds = (value: number): string => `${(value / 1000).toFixed(1)}s`;
/** A 0..1 rate as a whole-percent success figure. */
const asPercent = (value: number): string => `${Math.round(value * 100)}%`;
/** Imputed dollars, kept to cents and marked approximate and secondary. */
const asImputedDollars = (value: number): string => `~$${value.toFixed(2)}`;
/** A coverage figure as covered-of-total cells. */
const asCoverage = (coverage: Coverage): string => `${coverage.covered}/${coverage.tasksTotal}`;

/**
 * Render a table as aligned, space-separated columns. Column widths fit their
 * widest cell, so rendering is stable for a given set of rows regardless of the
 * order they were accumulated in.
 */
function renderTable(headers: string[], aligns: Align[], rows: string[][]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const pad = (text: string, column: number): string =>
    aligns[column] === "right" ? text.padStart(widths[column]!) : text.padEnd(widths[column]!);
  const line = (values: string[]): string =>
    values.map((value, column) => pad(value, column)).join("   ").trimEnd();
  return [line(headers), ...rows.map(line)];
}

/**
 * The headline table: one row per arm, cost-equivalent tokens as the headline
 * metric, then the raw token sum, turns, duration, success rate, and a coverage
 * figure, with imputed cost as a de-emphasized (parenthesized, approximate)
 * trailing column. Metric cells for an arm with no samples read as an em dash.
 */
function renderHeadline(report: Report): string[] {
  const headers = ["arm", "cost-eq", "raw", "turns", "duration", "success", "coverage", "(imputed $)"];
  const aligns: Align[] = ["left", "right", "right", "right", "right", "right", "right", "right"];
  const rows = report.headline.map((row) => [
    row.arm,
    cell(row.costEquivalentTokens, asInteger),
    cell(row.rawTokens, asInteger),
    cell(row.turns, asDecimal),
    cell(row.durationMs, asSeconds),
    cell(row.successRate, asPercent),
    asCoverage(row.coverage),
    cell(row.imputedCostUsd, asImputedDollars),
  ]);
  return [
    "Headline — cost-equivalent tokens (the headline metric), one row per arm:",
    ...renderTable(headers, aligns, rows),
  ];
}

/**
 * The coverage annotation: one line per arm marking its coverage complete or
 * incomplete, with the partial (below-floor) and missing (unsampled) cell counts
 * spelled out. This is what keeps a half-run matrix from reading as a full one —
 * an arm is never silently presented as complete when cells are still missing.
 */
function renderCoverage(report: Report): string[] {
  const tasksTotal = report.headline[0]?.coverage.tasksTotal ?? 0;
  const header = `Coverage — cells at or above the reporting floor of ${report.reportingFloor} samples, out of ${tasksTotal} tasks per arm:`;
  const lines = report.headline.map((row) => {
    const { covered, tasksTotal: total, partial, missing } = row.coverage;
    if (partial === 0 && missing === 0) {
      return `  ${row.arm}: ${covered}/${total} covered — complete`;
    }
    return `  ${row.arm}: ${covered}/${total} covered, ${partial} partial, ${missing} missing — incomplete`;
  });
  return [header, ...lines];
}

/**
 * The per-tier breakdown: for each tier, a small arm table of cost-equivalent
 * tokens (mean), success rate, and that tier's coverage. Shows where an arm wins
 * or loses across the tiers, derived from the same records as the headline.
 */
function renderTiers(report: Report): string[] {
  const headers = ["arm", "cost-eq", "success", "coverage"];
  const aligns: Align[] = ["left", "right", "right", "right"];
  const lines = ["Per-tier breakdown — cost-equivalent tokens (mean) and success rate by tier:"];
  for (const tier of report.tiers) {
    const rows = tier.arms.map((arm) => [
      arm.arm,
      cell(arm.costEquivalentTokens, asInteger),
      cell(arm.successRate, asPercent),
      asCoverage(arm.coverage),
    ]);
    lines.push(`  ${tier.tier}`);
    for (const line of renderTable(headers, aligns, rows)) {
      lines.push(`    ${line}`);
    }
  }
  return lines;
}

/**
 * The per-token-component breakdown: each arm's mean tokens per run split into
 * the four retained components, so a reader can see what drives an arm's cost
 * (typically cache-read volume). The component labels name the pricing tiers the
 * cost-equivalent weights apply to.
 */
function renderComponents(report: Report): string[] {
  const headers = ["arm", "fresh input", "cache write", "cache read", "output"];
  const aligns: Align[] = ["left", "right", "right", "right", "right"];
  const rows = report.components.map((row) => [
    row.arm,
    cell(row.freshInput, asInteger),
    cell(row.cacheCreation, asInteger),
    cell(row.cacheRead, asInteger),
    cell(row.output, asInteger),
  ]);
  return [
    "Per-token-component breakdown — mean tokens per run by component:",
    ...renderTable(headers, aligns, rows),
  ];
}

/**
 * The separate bonus table: the capability-asymmetric operations kept out of the
 * scored comparison, each with its direction, gitea-axi's own applicability, and a
 * note. Any arm that was actually run against a bonus cell is shown inline; most
 * are unrun, in which case only the capability annotation is reported.
 */
function renderBonus(report: Report): string[] {
  const lines = ["Bonus table — capability-asymmetric operations (outside the scored comparison):"];
  for (const row of report.bonus) {
    lines.push(`  ${row.operation}`);
    lines.push(`    direction: ${row.direction}; gitea-axi: ${row.giteaAxi}`);
    lines.push(`    note: ${row.note}`);
    if (row.arms.length === 0) {
      lines.push("    runs: none");
    } else {
      for (const arm of row.arms) {
        lines.push(
          `    runs: ${arm.arm} — ${cell(arm.costEquivalentTokens, asInteger)} cost-eq, ${cell(arm.successRate, asPercent)} pass (${arm.samples} sample(s))`,
        );
      }
    }
  }
  return lines;
}

/** Render an aggregated report into a stable, human-readable text block. */
export function renderReport(report: Report): string {
  const sections = [
    renderHeadline(report),
    renderCoverage(report),
    renderTiers(report),
    renderComponents(report),
    renderBonus(report),
  ];
  return `${sections.map((section) => section.join("\n")).join("\n\n")}\n`;
}
