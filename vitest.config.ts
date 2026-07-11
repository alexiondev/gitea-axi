import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit + integration tiers: fast, no external dependencies. The end-to-end
    // tier under test/e2e needs a live Gitea instance and runs via `test:e2e`.
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Measure the shipped source only; the CLI is exercised through its seam,
      // so coverage reflects what those tiers actually reach.
      include: ["src/**/*.ts"],
      exclude: [
        // Types-only: no runtime code to exercise.
        "src/deps.ts",
        // Bin entrypoint: process argv/stdout/EPIPE wiring that delegates to the
        // covered runCli seam; not reached by the in-process seam tests.
        "src/main.ts",
      ],
      // A regression ratchet, not a target: set a few points under current
      // coverage so a real drop fails CI while trivial churn does not. Raise
      // these as coverage climbs; never lower them to make a red build pass.
      thresholds: {
        statements: 92,
        branches: 87,
        functions: 95,
        lines: 92,
      },
    },
  },
});
