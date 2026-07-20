import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The packaging tier, in two facets. `tarball` asserts the shape of the
    // packed npm tarball and its manifest; `installed-binary` drives an
    // installed gitea-axi, either one named by GITEA_AXI_INSTALLED_BIN or one
    // it packs and installs itself. It builds, packs, and fetches runtime deps
    // from the registry, so it is far slower than the fast tiers and runs on
    // its own via `test:pack`. Distribution touches no Gitea API, so this smoke
    // test is the distribution analogue of the live-Gitea e2e tier rather than
    // a member of it.
    include: ["test/packaging/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // Each facet's setup may run `npm pack` against the one shared project
    // root, whose `prepack` writes `dist/`; serialize the files so two builds
    // cannot race on it.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
