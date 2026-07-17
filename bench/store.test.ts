import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResultRecord } from "./result.js";
import { createSampleStore } from "./store.js";

/** Build a valid ResultRecord with sensible defaults, overridable per test. */
function sample(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    arm: "gitea-axi",
    taskId: "issue-triage",
    tier: "single-mutation",
    trial: 1,
    timestamp: "2026-07-15T12:00:00Z",
    tokens: { freshInput: 100, cacheCreation: 200, cacheRead: 300, output: 40 },
    turns: 5,
    durationMs: 1234,
    imputedCostUsd: 0.0123,
    outcome: { pass: true },
    ...overrides,
  };
}

describe("SampleStore", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gitea-axi-store-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads back a sample appended to a cell", () => {
    const store = createSampleStore(root);
    const record = sample();

    store.append(record);

    expect(store.read({ arm: record.arm, taskId: record.taskId })).toEqual([record]);
  });

  it("preserves prior samples when appending to a cell, returning all in append order", () => {
    const store = createSampleStore(root);
    const first = sample({ trial: 1, outcome: { pass: true } });
    const second = sample({ trial: 2, outcome: { pass: false, failure: "incorrect" } });

    store.append(first);
    store.append(second);

    expect(store.read({ arm: "gitea-axi", taskId: "issue-triage" })).toEqual([first, second]);
  });

  it("keeps cells isolated on read and enumerates every written cell via cells()", () => {
    const store = createSampleStore(root);

    // Cell A: two samples (gitea-axi / issue-triage, read tier).
    const a1 = sample({ arm: "gitea-axi", taskId: "issue-triage", tier: "read", trial: 1 });
    const a2 = sample({ arm: "gitea-axi", taskId: "issue-triage", tier: "read", trial: 2 });
    // Cell B: one sample (tea / pr-review, single-mutation tier).
    const b1 = sample({ arm: "tea", taskId: "pr-review", tier: "single-mutation", trial: 1 });
    // Cell C: one sample (gitea-mcp / label-sync, multi-step tier).
    const c1 = sample({ arm: "gitea-mcp", taskId: "label-sync", tier: "multi-step", trial: 1 });

    // Interleave appends across cells to exercise isolation of the write path.
    store.append(a1);
    store.append(b1);
    store.append(a2);
    store.append(c1);

    expect(store.read({ arm: "gitea-axi", taskId: "issue-triage" })).toEqual([a1, a2]);
    expect(store.read({ arm: "tea", taskId: "pr-review" })).toEqual([b1]);
    expect(store.read({ arm: "gitea-mcp", taskId: "label-sync" })).toEqual([c1]);

    const enumerated = store.cells();
    expect(enumerated).toHaveLength(3);
    expect(enumerated).toEqual(
      expect.arrayContaining([
        { arm: "gitea-axi", taskId: "issue-triage" },
        { arm: "tea", taskId: "pr-review" },
        { arm: "gitea-mcp", taskId: "label-sync" },
      ]),
    );
  });

  it("reads back accumulated samples through a fresh store on the same root, deepening across runs", () => {
    const cell = { arm: "gitea-axi", taskId: "issue-triage" } as const;
    const first = sample({ trial: 1, outcome: { pass: true } });
    const second = sample({ trial: 2, outcome: { pass: false, failure: "hung" } });

    // First "run": append one sample, then let this store handle go out of scope.
    const firstRun = createSampleStore(root);
    firstRun.append(first);

    // Second, independent "run" on the same root — a later process reopening it.
    const secondRun = createSampleStore(root);
    expect(secondRun.read(cell)).toEqual([first]);

    // Deepening the cell through the second store accumulates rather than resets.
    secondRun.append(second);
    expect(secondRun.read(cell)).toEqual([first, second]);
  });

  // Behavior: the store round-trips a report-bearing record without any change to
  // the store itself. A read task's record carries the agent's final report in the
  // `report` field; appending it and reading it back must return it equal, `report`
  // and all, proving the store persists the field with no store change. The planted
  // report string is an independent literal, not anything production code computes.
  it("round-trips a record carrying a report field, preserving it unchanged", () => {
    const store = createSampleStore(root);
    const report = "There are 5 open issues in the repository.";
    const record = sample({ tier: "read", report });

    store.append(record);

    const readBack = store.read({ arm: record.arm, taskId: record.taskId });
    expect(readBack).toEqual([record]);
    const [only] = readBack;
    expect(only).toBeDefined();
    if (only === undefined) return;
    expect(only.report).toBe(report);
  });
});
