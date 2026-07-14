import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The packaging tier: pack the real tarball, install it globally into a
    // throwaway prefix, then drive the installed binary. It builds, packs, and
    // fetches runtime deps from the registry, so it is far slower than the fast
    // tiers and runs on its own via `test:pack`. Distribution touches no Gitea
    // API, so this smoke test is the distribution analogue of the live-Gitea
    // e2e tier rather than a member of it.
    include: ["test/packaging/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // Keep the pack/install work in one process: the tarball is built once in a
    // shared setup and reused across the assertions.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
