import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The seed smoke tier: a single live end-to-end validation that provisioning
    // and seeding a throwaway repository really brings it to the ground truth,
    // and that re-seeding is idempotent. Like the e2e tier, it targets a live
    // host — here the maintainer's own, discovered through gitea-axi's tea-login
    // credential path — and skips cleanly when none is configured
    // (GITEA_AXI_BENCH_LOGIN unset), which must count as a pass, not "no tests
    // found". It is deliberately kept out of the deterministic bench tier.
    include: ["bench/**/*.smoke.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    passWithNoTests: true,
  },
});
