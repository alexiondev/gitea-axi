import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregate,
  costEquivalentTokens,
  readAllSamples,
  renderReport,
} from "./aggregate.js";
import type { ResultRecord, TokenComponents } from "./result.js";
import { createSampleStore } from "./store.js";

/** A minimal ResultRecord for the gitea-axi arm, overridable per sample. */
function record(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    arm: "gitea-axi",
    taskId: "t1",
    tier: "read",
    trial: 1,
    timestamp: "2026-07-16T00:00:00Z",
    tokens: { freshInput: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
    turns: 0,
    durationMs: 0,
    imputedCostUsd: 0,
    outcome: { pass: true },
    ...overrides,
  };
}

describe("costEquivalentTokens", () => {
  // Behavior: cost-equivalent tokens weight a run's four retained token
  // components by Anthropic's published API pricing ratios — fresh input 1x,
  // cache-write 1.25x, cache-read 0.1x, output 5x (ADR 0014). The expected
  // total is derived BY HAND from those ratios, not recomputed the way the
  // code would, so it independently pins the metric.
  //
  // Distinct components are chosen so each of the four weighted products is a
  // different number and no two raw components share a value; a wrong weight on
  // any single component therefore cannot be masked by another:
  //   freshInput    400 * 1    =  400
  //   cacheCreation 800 * 1.25 = 1000
  //   cacheRead    2000 * 0.1  =  200
  //   output        600 * 5    = 3000
  //   total                    = 4600
  it("weights the four retained token components by the documented pricing ratios", () => {
    const tokens: TokenComponents = {
      freshInput: 400,
      cacheCreation: 800,
      cacheRead: 2000,
      output: 600,
    };

    expect(costEquivalentTokens(tokens)).toBe(4600);
  });
});

describe("aggregate", () => {
  // Behavior: the headline view yields one row per arm whose per-run metrics —
  // cost-equivalent tokens (the headline), raw tokens, turns, duration, and
  // imputed cost — are the MEANS across that arm's samples, and whose success
  // rate is the fraction of its runs that passed. Here the gitea-axi arm has
  // two samples on task t1 (one pass, one fail). Every expected number below is
  // derived BY HAND from the two samples and the ADR 0014 pricing ratios
  // (fresh input 1x, cache-write 1.25x, cache-read 0.1x, output 5x), so it
  // pins the metric independently of how aggregate computes it:
  //   cost-equiv A = 100*1 + 20*5 = 200; B = 200*1 + 40*5 = 400; mean = 300
  //   raw tokens  A = 120; B = 240; mean = 180
  //   turns       (5 + 7) / 2 = 6
  //   durationMs  (1000 + 3000) / 2 = 2000
  //   successRate 1 pass of 2 = 0.5
  //   imputedCost (0.02 + 0.06) / 2 = 0.04
  it("yields one headline row per arm with per-run means and the passing fraction as success rate", () => {
    const sampleA = record({
      trial: 1,
      tokens: { freshInput: 100, cacheCreation: 0, cacheRead: 0, output: 20 },
      turns: 5,
      durationMs: 1000,
      imputedCostUsd: 0.02,
      outcome: { pass: true },
    });
    const sampleB = record({
      trial: 2,
      tokens: { freshInput: 200, cacheCreation: 0, cacheRead: 0, output: 40 },
      turns: 7,
      durationMs: 3000,
      imputedCostUsd: 0.06,
      outcome: { pass: false, failure: "incorrect" },
    });

    const report = aggregate({
      records: [sampleA, sampleB],
      suite: [{ id: "t1", tier: "read" }],
      bonus: [],
    });

    const row = report.headline.find((r) => r.arm === "gitea-axi");
    if (!row) throw new Error("expected a gitea-axi headline row");

    expect(row.samples).toBe(2);
    expect(row.costEquivalentTokens).toBeCloseTo(300);
    expect(row.rawTokens).toBeCloseTo(180);
    expect(row.turns).toBeCloseTo(6);
    expect(row.durationMs).toBeCloseTo(2000);
    expect(row.successRate).toBeCloseTo(0.5);
    expect(row.imputedCostUsd).toBeCloseTo(0.04);
  });

  // Behavior: the per-tier breakdown is rendered from the same records — grouped
  // by tier, then by arm — reporting each tier-arm's cost-equivalent-token mean
  // and passing fraction. Three gitea-axi samples span two tiers: two on a read
  // task r1 (one pass, one fail) and one on a single-mutation task m1 (pass).
  // Every expected number is derived BY HAND from those samples and the ADR 0014
  // weights (fresh input 1x, output 5x; no cache here), independent of how
  // aggregate computes them:
  //   read  gitea-axi: cost A = 100 + 20*5 = 200; B = 200 + 40*5 = 400;
  //                    mean = 300; success 1 of 2 = 0.5; samples 2
  //   single-mutation gitea-axi: cost = 50 + 10*5 = 100; success 1 of 1 = 1;
  //                    samples 1
  // The tier order is the fixed reporting order, an independent literal.
  it("breaks records down per tier and per arm with cost-equivalent-token means and success rates", () => {
    const r1a = record({
      taskId: "r1",
      tier: "read",
      trial: 1,
      tokens: { freshInput: 100, cacheCreation: 0, cacheRead: 0, output: 20 },
      outcome: { pass: true },
    });
    const r1b = record({
      taskId: "r1",
      tier: "read",
      trial: 2,
      tokens: { freshInput: 200, cacheCreation: 0, cacheRead: 0, output: 40 },
      outcome: { pass: false, failure: "incorrect" },
    });
    const m1c = record({
      taskId: "m1",
      tier: "single-mutation",
      trial: 1,
      tokens: { freshInput: 50, cacheCreation: 0, cacheRead: 0, output: 10 },
      outcome: { pass: true },
    });

    const report = aggregate({
      records: [r1a, r1b, m1c],
      suite: [
        { id: "r1", tier: "read" },
        { id: "m1", tier: "single-mutation" },
      ],
      bonus: [],
    });

    // One breakdown per tier, in the fixed reporting order.
    expect(report.tiers.map((t) => t.tier)).toEqual([
      "read",
      "single-mutation",
      "find-then-act",
      "multi-step",
    ]);

    const readAxi = report.tiers
      .find((t) => t.tier === "read")
      ?.arms.find((a) => a.arm === "gitea-axi");
    if (!readAxi) throw new Error("expected a read/gitea-axi tier-arm");
    expect(readAxi.samples).toBe(2);
    expect(readAxi.costEquivalentTokens).toBeCloseTo(300);
    expect(readAxi.successRate).toBeCloseTo(0.5);

    const mutAxi = report.tiers
      .find((t) => t.tier === "single-mutation")
      ?.arms.find((a) => a.arm === "gitea-axi");
    if (!mutAxi) throw new Error("expected a single-mutation/gitea-axi tier-arm");
    expect(mutAxi.samples).toBe(1);
    expect(mutAxi.costEquivalentTokens).toBeCloseTo(100);
    expect(mutAxi.successRate).toBeCloseTo(1);
  });

  // Behavior: the per-token-component breakdown is rendered from the same
  // records — per arm, the per-run MEAN of each of the four raw token
  // components — so a reader can see what drives an arm's cost. The gitea-axi
  // arm has two samples; an arm with no samples reports null for every
  // component. Each mean is derived BY HAND from the two samples, independent
  // of how aggregate computes it:
  //   freshInput    (100 + 200) / 2 = 150
  //   cacheCreation (40 + 60)   / 2 = 50
  //   cacheRead     (1000 + 3000)/2 = 2000
  //   output        (20 + 40)   / 2 = 30
  it("breaks records down per arm into the per-run mean of each token component", () => {
    const sampleA = record({
      trial: 1,
      tokens: { freshInput: 100, cacheCreation: 40, cacheRead: 1000, output: 20 },
    });
    const sampleB = record({
      trial: 2,
      tokens: { freshInput: 200, cacheCreation: 60, cacheRead: 3000, output: 40 },
    });

    const report = aggregate({
      records: [sampleA, sampleB],
      suite: [{ id: "t1", tier: "read" }],
      bonus: [],
    });

    const axi = report.components.find((c) => c.arm === "gitea-axi");
    if (!axi) throw new Error("expected a gitea-axi component breakdown");
    expect(axi.freshInput).toBeCloseTo(150);
    expect(axi.cacheCreation).toBeCloseTo(50);
    expect(axi.cacheRead).toBeCloseTo(2000);
    expect(axi.output).toBeCloseTo(30);

    // An arm with no samples reports null for every component.
    const tea = report.components.find((c) => c.arm === "tea");
    if (!tea) throw new Error("expected a tea component breakdown");
    expect(tea.freshInput).toBeNull();
    expect(tea.cacheCreation).toBeNull();
    expect(tea.cacheRead).toBeNull();
    expect(tea.output).toBeNull();
  });

  // Behavior: the separate bonus table is rendered from the same records. It
  // emits one row per supplied bonus definition, in the given order, carrying
  // that operation's capability metadata (operation text, direction, note, and
  // gitea-axi's own applicability), plus — for any arm that actually has
  // samples for that bonus cell — the per-arm run metrics. Bonus cells are
  // usually unrun, so a cell's arms list is empty unless records exist for it.
  // Here bonus-x has one tea sample and bonus-y has none. The one derived
  // number is by hand from that sample and the ADR 0014 weights (fresh input
  // 1x, output 5x): cost = 100 + 20*5 = 200.
  it("emits one bonus row per definition with its capability metadata and per-arm samples only where run", () => {
    const teaSample = record({
      arm: "tea",
      taskId: "bonus-x",
      tier: "read",
      trial: 1,
      tokens: { freshInput: 100, cacheCreation: 0, cacheRead: 0, output: 20 },
      outcome: { pass: true },
    });

    const report = aggregate({
      records: [teaSample],
      suite: [],
      bonus: [
        {
          id: "bonus-x",
          operation: "Do the X thing",
          direction: "gitea-axi-advantage",
          note: "only gitea-axi does X ergonomically",
          giteaAxi: "applicable",
        },
        {
          id: "bonus-y",
          operation: "Do the Y thing",
          direction: "gitea-axi-not-applicable",
          note: "Y is outside gitea-axi's surface",
          giteaAxi: "not-applicable",
        },
      ],
    });

    // One row per definition, in the given order.
    expect(report.bonus.map((b) => b.id)).toEqual(["bonus-x", "bonus-y"]);

    // bonus-x carries its capability metadata and the tea cell's metrics.
    const bx = report.bonus.find((b) => b.id === "bonus-x");
    if (!bx) throw new Error("expected a bonus-x row");
    expect(bx.operation).toBe("Do the X thing");
    expect(bx.direction).toBe("gitea-axi-advantage");
    expect(bx.note).toBe("only gitea-axi does X ergonomically");
    expect(bx.giteaAxi).toBe("applicable");

    const bxTea = bx.arms.find((a) => a.arm === "tea");
    if (!bxTea) throw new Error("expected a tea entry on bonus-x");
    expect(bx.arms).toHaveLength(1);
    expect(bxTea.samples).toBe(1);
    expect(bxTea.costEquivalentTokens).toBeCloseTo(200);
    expect(bxTea.successRate).toBeCloseTo(1);

    // bonus-y was never run, so it carries metadata but no arm metrics.
    const by = report.bonus.find((b) => b.id === "bonus-y");
    if (!by) throw new Error("expected a bonus-y row");
    expect(by.giteaAxi).toBe("not-applicable");
    expect(by.direction).toBe("gitea-axi-not-applicable");
    expect(by.arms).toEqual([]);
  });
});

describe("renderReport", () => {
  // Behavior: the rendered headline table shows one row per arm, presents
  // cost-equivalent tokens as the headline metric column and imputed cost as a
  // de-emphasized secondary column, and marks an arm with no samples with the
  // "—" placeholder. Two gitea-axi samples on t1 give a cost-equivalent mean of
  // (200 + 400)/2 = 300 and an imputed-cost mean of (0.02 + 0.06)/2 = 0.04,
  // both derived BY HAND, independent of how the report is rendered. Assertions
  // target the gitea-axi row's own line and the presence of labels/values —
  // never fixed column widths — so they survive a layout refactor.
  it("renders one row per arm with cost-equivalent tokens as the headline and imputed cost as a secondary column", () => {
    const sampleA = record({
      trial: 1,
      tokens: { freshInput: 100, cacheCreation: 0, cacheRead: 0, output: 20 },
      turns: 5,
      durationMs: 1000,
      imputedCostUsd: 0.02,
      outcome: { pass: true },
    });
    const sampleB = record({
      trial: 2,
      tokens: { freshInput: 200, cacheCreation: 0, cacheRead: 0, output: 40 },
      turns: 7,
      durationMs: 3000,
      imputedCostUsd: 0.06,
      outcome: { pass: false, failure: "incorrect" },
    });

    const output = renderReport(
      aggregate({
        records: [sampleA, sampleB],
        suite: [{ id: "t1", tier: "read" }],
        bonus: [],
      }),
    );

    // Every arm gets a row.
    expect(output).toContain("gitea-axi");
    expect(output).toContain("tea");
    expect(output).toContain("gitea-mcp");
    expect(output).toContain("raw-api");

    // The headline metric and the secondary column are labelled.
    expect(output.toLowerCase()).toContain("cost-equivalent");
    expect(output.toLowerCase()).toContain("imputed");

    // The gitea-axi row carries its cost-equivalent mean (300) and imputed
    // mean (0.04) on its own line.
    const axiLine = output.split("\n").find((l) => l.includes("gitea-axi"));
    if (!axiLine) throw new Error("expected a gitea-axi row line");
    expect(axiLine).toContain("300");
    expect(axiLine).toContain("0.04");

    // An arm with no samples shows the em-dash placeholder on its row. The
    // "tea" arm token is matched at a word boundary so the substring inside
    // "gitea-axi"/"gitea-mcp" cannot be mistaken for the tea row.
    const teaLine = output
      .split("\n")
      .find((l) => /(^|[^a-z-])tea([^a-z-]|$)/.test(l));
    if (!teaLine) throw new Error("expected a tea row line");
    expect(teaLine).toContain("—");
  });

  // Behavior: a partial matrix renders without error and incomplete coverage is
  // annotated rather than hidden or treated as complete. With the default
  // reporting floor of 3, a cell is covered at >=3 samples, partial at 1-2, and
  // missing at 0. gitea-axi has one covered / one partial / one missing cell,
  // so it is incomplete; tea has all three cells covered, so it is complete.
  // The coverage counts (1 partial, 1 missing for gitea-axi) are derived BY
  // HAND from the sample layout, independent of how the report is rendered.
  // Lines are located by content, not index, so the assertions survive a
  // layout refactor.
  it("renders a partial matrix without throwing and annotates incomplete coverage rather than hiding it", () => {
    const read = (taskId: string, trial: number) =>
      record({ taskId, tier: "read", trial, outcome: { pass: true } });

    const records: ResultRecord[] = [
      // gitea-axi: t1 covered (3), t2 partial (2), t3 missing (0).
      read("t1", 1),
      read("t1", 2),
      read("t1", 3),
      read("t2", 1),
      read("t2", 2),
      // tea: all three tasks covered (3 each).
      { ...read("t1", 1), arm: "tea" },
      { ...read("t1", 2), arm: "tea" },
      { ...read("t1", 3), arm: "tea" },
      { ...read("t2", 1), arm: "tea" },
      { ...read("t2", 2), arm: "tea" },
      { ...read("t2", 3), arm: "tea" },
      { ...read("t3", 1), arm: "tea" },
      { ...read("t3", 2), arm: "tea" },
      { ...read("t3", 3), arm: "tea" },
    ];

    const input = {
      records,
      suite: [
        { id: "t1", tier: "read" as const },
        { id: "t2", tier: "read" as const },
        { id: "t3", tier: "read" as const },
      ],
      bonus: [],
    };

    // A partial matrix renders without error.
    expect(() => renderReport(aggregate(input))).not.toThrow();

    const output = renderReport(aggregate(input));

    // The coverage annotation names the reporting floor it is measured against.
    expect(output).toContain("reporting floor of 3");

    // gitea-axi is incomplete: 1 partial, 1 missing, flagged incomplete.
    const axiLine = output
      .split("\n")
      .find((l) => /\bgitea-axi\b/.test(l) && l.includes("partial"));
    if (!axiLine) throw new Error("expected a gitea-axi coverage annotation");
    expect(axiLine).toContain("1 partial");
    expect(axiLine).toContain("1 missing");
    expect(axiLine).toContain("incomplete");

    // tea is complete and is not labelled incomplete.
    const teaLine = output
      .split("\n")
      .find((l) => /(^|[^a-z-])tea([^a-z-]|$)/.test(l) && l.includes("complete"));
    if (!teaLine) throw new Error("expected a tea coverage annotation");
    expect(teaLine).toContain("complete");
    expect(teaLine).not.toContain("incomplete");
  });

  // Behavior: the per-tier breakdown, the per-token-component breakdown, and the
  // separate bonus table are all rendered from the same records — each as its
  // own section surfacing its content. A single gitea-axi sample on a read task
  // fixes the component means (one sample, so each mean equals its raw value):
  // fresh input 300, cache write 80, cache read 1000, output 60 — derived BY
  // HAND, independent of how the report renders. Assertions are presence-based
  // (section headers and content strings), not column layout, so they survive a
  // rendering refactor.
  it("renders the per-tier, per-token-component, and bonus sections from the same records", () => {
    const output = renderReport(
      aggregate({
        records: [
          record({
            taskId: "r1",
            tier: "read",
            trial: 1,
            tokens: {
              freshInput: 300,
              cacheCreation: 80,
              cacheRead: 1000,
              output: 60,
            },
            outcome: { pass: true },
          }),
        ],
        suite: [
          { id: "r1", tier: "read" },
          { id: "m1", tier: "single-mutation" },
        ],
        bonus: [
          {
            id: "bonus-x",
            operation: "Do the X thing",
            direction: "gitea-axi-advantage",
            note: "only gitea-axi does X",
            giteaAxi: "applicable",
          },
        ],
      }),
    );

    const lower = output.toLowerCase();

    // Per-tier section: a header naming tiers, and every tier surfaced.
    expect(lower).toContain("tier");
    expect(output).toContain("read");
    expect(output).toContain("single-mutation");
    expect(output).toContain("find-then-act");
    expect(output).toContain("multi-step");

    // Per-token-component section: a header, the four component labels, and
    // gitea-axi's component means.
    expect(lower).toContain("component");
    expect(lower).toContain("fresh input");
    expect(lower).toContain("cache write");
    expect(lower).toContain("cache read");
    expect(lower).toContain("output");
    expect(output).toContain("300");
    expect(output).toContain("80");
    expect(output).toContain("1000");
    expect(output).toContain("60");

    // Bonus section: a header, the operation text, and gitea-axi's applicability.
    expect(lower).toContain("bonus");
    expect(output).toContain("Do the X thing");
    expect(output).toContain("applicable");
  });
});

describe("renderReport over an append-only sample store", () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), "bench-aggregate-"));
    rootB = mkdtempSync(join(tmpdir(), "bench-aggregate-"));
  });

  afterEach(() => {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  // Behavior: rendering is stable — the rendered report is a function of the
  // accumulated set of samples only, so the order in which samples were
  // appended to the store must not change the output. This is a stability
  // property a correct implementation already satisfies, exercised end to end
  // through the real append-only store. The same records are appended to two
  // independent stores in genuinely different orders (one reversed and with
  // cells interleaved differently); the two rendered reports must be identical.
  it("renders identically regardless of the order samples were appended", () => {
    // A set spanning two arms and two tasks; the gitea-axi/t1 cell reaches the
    // reporting floor of three so the headline and coverage sections are
    // non-trivial rather than all placeholders.
    const records: ResultRecord[] = [
      record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 1 }),
      record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 2 }),
      record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 3 }),
      record({ arm: "gitea-axi", taskId: "t2", tier: "single-mutation", trial: 1 }),
      record({ arm: "tea", taskId: "t1", tier: "read", trial: 1 }),
      record({ arm: "tea", taskId: "t2", tier: "single-mutation", trial: 1 }),
      record({ arm: "tea", taskId: "t2", tier: "single-mutation", trial: 2 }),
    ];

    // Two genuinely different append orders over the same set.
    const orderA = records;
    const orderB = [...records].reverse();
    // The two orders truly differ, so the stability claim is not vacuous.
    expect(orderB).not.toEqual(orderA);

    const storeA = createSampleStore(rootA);
    for (const r of orderA) storeA.append(r);

    const storeB = createSampleStore(rootB);
    for (const r of orderB) storeB.append(r);

    const suite = [
      { id: "t1", tier: "read" as const },
      { id: "t2", tier: "single-mutation" as const },
    ];

    const a = renderReport(
      aggregate({ records: readAllSamples(storeA), suite, bonus: [] }),
    );
    const b = renderReport(
      aggregate({ records: readAllSamples(storeB), suite, bonus: [] }),
    );

    // Append order does not affect the rendered report.
    expect(a).toBe(b);

    // Non-vacuity: the report actually rendered real headline content.
    expect(a.length).toBeGreaterThan(0);
    expect(a).toContain("gitea-axi");
    expect(a.toLowerCase()).toContain("cost-equivalent");
  });
});
