import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CliDeps } from "../src/deps.js";
import { liveBenchHost } from "./host.js";
import { runCell } from "./runner.js";
import { resolveBenchAccess, type BenchAccess } from "./seed.js";
import { sdkAgentDriver } from "./sdk-driver.js";
import { createSampleStore } from "./store.js";
import { SAMPLE_TASK } from "./task.js";

/**
 * The single-cell runner smoke tier: one live run of the whole tracer-bullet path
 * against a real Gitea host, driving the agent through the Claude Agent SDK. It
 * proves that seed, arm scaffolding, guard, runner, checker, and store all connect
 * end to end — provisioning and seeding a fresh repository, running the sample task
 * under the gitea-axi arm, capturing and scoring the result, appending the sample,
 * and deleting the repository.
 *
 * Like the seed smoke tier it keys off GITEA_AXI_BENCH_LOGIN (the live host,
 * discovered through gitea-axi's tea-login credential path) and skips cleanly when
 * that is unset. It additionally skips when the Agent SDK is not installed, since
 * the SDK is an optional peer of the harness needed only for live runs — either
 * way a skip counts as a pass, matching the end-to-end tier's behaviour when no
 * live instance is configured. Running it for real also requires the `gitea-axi`
 * CLI on PATH (the arm's allow-listed binary) and a Claude subscription.
 *
 * The run's pass/fail is nondeterministic because a live model drives it, so the
 * assertions are structural — the terminal outcome shape and the record and
 * lifecycle facts — never a fixed pass/fail.
 */
const login = process.env.GITEA_AXI_BENCH_LOGIN;

// The Agent SDK is loaded through a computed specifier so this file type-checks and
// the deterministic tier runs without the package present; here we probe once
// whether it is installed so the tier skips rather than errors when it is absent.
const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";
let sdkAvailable = false;
try {
  await import(SDK_MODULE);
  sdkAvailable = true;
} catch {
  sdkAvailable = false;
}

describe.skipIf(!login || !sdkAvailable)("single-cell runner smoke", () => {
  let access: BenchAccess;
  let binRoot: string;
  let storeRoot: string;

  beforeAll(async () => {
    const deps: CliDeps = {
      env: process.env,
      cwd: process.cwd(),
      globals: { login },
    };
    access = await resolveBenchAccess(deps, login!);
    binRoot = mkdtempSync(join(tmpdir(), "bench-runner-smoke-bin-"));
    storeRoot = mkdtempSync(join(tmpdir(), "bench-runner-smoke-store-"));
  }, 180_000);

  afterAll(() => {
    if (binRoot) rmSync(binRoot, { recursive: true, force: true });
    if (storeRoot) rmSync(storeRoot, { recursive: true, force: true });
  });

  it(
    "runs one sample cell end to end against the live host, recording a scored or invalid result",
    async () => {
      const store = createSampleStore(storeRoot);

      const outcome = await runCell({
        arm: "gitea-axi",
        task: SAMPLE_TASK,
        trial: 1,
        access,
        host: liveBenchHost(access),
        driver: sdkAgentDriver(),
        store,
        // The runner's own wall-clock backstop bounds the run well within the
        // per-test timeout below.
        bounds: { turnCap: 40, wallClockMs: 300_000 },
        build: { binRoot },
      });

      // The full path completed: the cell was either scored (recorded) or the
      // audit flagged a leak (invalid) — both are legitimate terminal outcomes,
      // and either way the throwaway repository was deleted in runCell's finally.
      expect(["recorded", "invalid"]).toContain(outcome.kind);

      if (outcome.kind === "recorded") {
        const samples = store.read({ arm: "gitea-axi", taskId: SAMPLE_TASK.id });
        expect(samples).toHaveLength(1);
        expect(outcome.record.taskId).toBe(SAMPLE_TASK.id);
        expect(outcome.record.tier).toBe(SAMPLE_TASK.tier);
        // The four token components and the imputed cost were captured.
        expect(outcome.record.tokens).toEqual(
          expect.objectContaining({
            freshInput: expect.any(Number),
            cacheCreation: expect.any(Number),
            cacheRead: expect.any(Number),
            output: expect.any(Number),
          }),
        );
        expect(typeof outcome.record.imputedCostUsd).toBe("number");
      }
    },
    360_000,
  );
});
