import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The end-to-end tier only: the same CLI seam as the integration tier, but
    // driven against a live disposable Gitea instance (see test/e2e). Provision
    // and network round-trips need a longer timeout than the fast tiers.
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 150_000,
    // Without a live instance (GITEA_AXI_E2E_URL unset) every suite skips;
    // that must be a pass, not a "no tests found" failure.
    passWithNoTests: true,
  },
});
