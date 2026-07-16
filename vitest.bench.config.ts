import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The benchmark harness tier. The harness lives in bench/ (excluded from the
    // published npm package) and its deterministic seams — the sample store,
    // checker, guard, and aggregator — are unit-tested here, colocated with the
    // source. It runs on its own via `test:bench` and is kept out of the main
    // fast tier so bench code never counts against src coverage thresholds.
    include: ["bench/**/*.test.ts"],
    // The live seed smoke run is its own tier (vitest.bench-smoke.config.ts); it
    // talks to a real Gitea host, so it stays out of this deterministic tier.
    exclude: ["bench/**/*.smoke.test.ts", "**/node_modules/**"],
    passWithNoTests: true,
  },
});
