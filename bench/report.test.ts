import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliDeps } from "../src/deps.js";
import type { ResultRecord } from "./result.js";
import { createSampleStore, DEFAULT_STORE_ROOT } from "./store.js";
import { parseReportArgs, runReportCommand } from "./report.js";

/** A minimal passing gitea-axi ResultRecord, overridable per sample. */
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

describe("parseReportArgs", () => {
  // Behavior: with no arguments the parser resolves the documented defaults —
  // the store root falls back to the module's DEFAULT_STORE_ROOT constant (the
  // single source of truth for that default, so we assert against the imported
  // constant rather than the hardcoded "bench/results" string, checking the
  // parser wires the module default through on omission), and self-review
  // defaults to permitted, the richer scored variant (independent literal true).
  it("resolves the documented defaults when no arguments are given", () => {
    const result = parseReportArgs([]);

    expect(result.help).toBe(false);
    if (result.help) return;

    expect(result.storeRoot).toBe(DEFAULT_STORE_ROOT);
    expect(result.selfReview).toBe(true);
  });

  // Behavior: the spaced value form of --store overrides the store root the report
  // reads, and --no-self-review flips the self-review variant off. Expected values
  // are independent literals: the store root the maintainer supplied and false.
  it("overrides the store root via spaced --store and disables self-review via --no-self-review", () => {
    const result = parseReportArgs(["--store", "/tmp/bench-out", "--no-self-review"]);

    expect(result.help).toBe(false);
    if (result.help) return;

    expect(result.storeRoot).toBe("/tmp/bench-out");
    expect(result.selfReview).toBe(false);
  });

  // Behavior: --store also accepts the inline --store=<dir> form, and --self-review
  // states the default explicitly (permitted). Expected values are independent
  // literals: the inline store root and true.
  it("accepts the inline --store=<dir> form and honors an explicit --self-review", () => {
    const result = parseReportArgs(["--store=/tmp/x", "--self-review"]);

    expect(result.help).toBe(false);
    if (result.help) return;

    expect(result.storeRoot).toBe("/tmp/x");
    expect(result.selfReview).toBe(true);
  });

  // Behavior: malformed input is rejected with a usage error — an unknown flag, a
  // bare positional argument (not a --flag), a value flag (--store) missing its
  // value, and a value handed to the boolean --self-review (which takes none).
  it("rejects malformed input with a usage error", () => {
    // Unknown flag.
    expect(() => parseReportArgs(["--frobnicate", "x"])).toThrow();
    // Bare positional argument, not a --flag.
    expect(() => parseReportArgs(["positional"])).toThrow();
    // Value flag missing its value.
    expect(() => parseReportArgs(["--store"])).toThrow();
    // The boolean --self-review takes no value.
    expect(() => parseReportArgs(["--self-review=yes"])).toThrow();
  });

  // Behavior: --help and its -h alias short-circuit parsing to a help request,
  // winning even alongside other arguments.
  it("short-circuits to a help request for --help and -h, even alongside other args", () => {
    expect(parseReportArgs(["--help"]).help).toBe(true);
    expect(parseReportArgs(["-h"]).help).toBe(true);
    expect(parseReportArgs(["--store", "/tmp/x", "--help"]).help).toBe(true);
  });
});

describe("runReportCommand", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bench-report-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Behavior: the offline reporting boundary opens the sample store at --store,
  // drains it, aggregates against the scored suite and bonus, and prints the
  // rendered comparison line-by-line through `out`, returning exit code 0. Given
  // three passing gitea-axi samples on one read task — reaching the reporting
  // floor of three — the rendered output labels the headline metric
  // ("cost-equivalent", per the spec / ADR 0014), gives every arm a row (the
  // four arms are gitea-axi, tea, gitea-mcp, raw-api), and annotates coverage
  // against the "reporting floor of 3". Assertions are on the exit code and the
  // presence of content, never on column layout, so they survive a rendering
  // refactor. The command reads no credentials, host, or SDK, so deps are empty.
  it("opens the store, aggregates, and prints the rendered comparison with exit code 0", async () => {
    const store = createSampleStore(root);
    store.append(record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 1 }));
    store.append(record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 2 }));
    store.append(record({ arm: "gitea-axi", taskId: "t1", tier: "read", trial: 3 }));

    const deps: CliDeps = { env: {}, cwd: "/", globals: {} };
    const lines: string[] = [];
    const code = await runReportCommand(["--store", root], deps, (l) => lines.push(l));
    const output = lines.join("\n");

    // Success exit code.
    expect(code).toBe(0);

    // The headline metric is labelled.
    expect(output.toLowerCase()).toContain("cost-equivalent");

    // Every arm gets a row.
    expect(output).toContain("gitea-axi");
    expect(output).toContain("tea");

    // Coverage is annotated against the reporting floor of three, which the
    // three samples reach.
    expect(output).toContain("reporting floor of 3");
  });

  // Behavior: an empty (never-written) store renders without error, inheriting
  // the aggregator's placeholder behavior rather than special-casing it. The
  // headline still labels the metric and every arm, and marks the unrun arms
  // with the em-dash placeholder ("—", U+2014) rather than a misleading zero —
  // the established renderReport behavior pinned by bench/aggregate.test.ts.
  // Returns exit code 0. The `root` from beforeEach is created empty; nothing is
  // appended.
  it("renders an empty store without error, marking unrun arms with the em-dash placeholder", async () => {
    const deps: CliDeps = { env: {}, cwd: "/", globals: {} };
    const lines: string[] = [];
    const code = await runReportCommand(["--store", root], deps, (l) => lines.push(l));
    const output = lines.join("\n");

    // Success exit code.
    expect(code).toBe(0);

    // The headline metric is labelled and every arm still appears.
    expect(output.toLowerCase()).toContain("cost-equivalent");
    expect(output).toContain("gitea-axi");

    // An unrun arm shows the em-dash placeholder, never a zero.
    expect(output).toContain("—");
  });

  // Behavior: --help prints the command's help and returns 0 without reading any
  // store, so it works before a store exists. No store path is created or
  // referenced. The help text names the command ("bench:report") — an
  // independent literal.
  it("prints help naming the command and returns 0 without reading a store", async () => {
    const deps: CliDeps = { env: {}, cwd: "/", globals: {} };
    const lines: string[] = [];
    const code = await runReportCommand(["--help"], deps, (l) => lines.push(l));
    const output = lines.join("\n");

    expect(code).toBe(0);
    expect(output).toContain("bench:report");
  });
});
