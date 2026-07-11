import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit + integration tiers: fast, no external dependencies. The end-to-end
    // tier under test/e2e needs a live Gitea instance and runs via `test:e2e`.
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
  },
});
