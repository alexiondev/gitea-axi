import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CliDeps } from "../src/deps.js";
import { SEED_PLAN } from "./seed-plan.js";
import {
  deleteRepo,
  provisionRepo,
  readSeedSummary,
  resolveBenchAccess,
  seedRepo,
  type BenchAccess,
  type RepoCoords,
  type SeedSummary,
} from "./seed.js";

/**
 * The seed smoke tier: a single live validation that provisioning and seeding a
 * throwaway repository really brings it to the declared ground truth, and that
 * re-seeding is idempotent. The benchmark-harness spec designates seed
 * provisioning as validated by a smoke run against a real host rather than by
 * mocks, since its value is the real API interaction. Like the e2e tier keys off
 * GITEA_AXI_E2E_URL, this suite skips cleanly when GITEA_AXI_BENCH_LOGIN is
 * unset, which counts as a pass. Expected values are derived from SEED_PLAN, the
 * declared ground-truth contract, never from seed.ts.
 */
const login = process.env.GITEA_AXI_BENCH_LOGIN;

describe.skipIf(!login)("seed smoke: provisioning and seeding", () => {
  let access: BenchAccess;
  let coords: RepoCoords;

  beforeAll(async () => {
    const deps: CliDeps = {
      env: process.env,
      cwd: process.cwd(),
      globals: { login },
    };
    access = await resolveBenchAccess(deps, login!);
    coords = await provisionRepo(access);
  }, 180_000);

  afterAll(async () => {
    if (access && coords) {
      await deleteRepo(access, coords).catch(() => {});
    }
  }, 60_000);

  it("provisioning a fresh repository and seeding it produces the fixed labels, the open/closed issue spread, and the labelled and reviewed pull requests", async () => {
    await seedRepo(access, coords);
    const summary = await readSeedSummary(access, coords);

    for (const label of SEED_PLAN.labels) {
      expect(summary.labelNames).toContain(label.name);
    }

    const expectedOpen = new Set(
      SEED_PLAN.issues.filter((i) => i.state === "open").map((i) => i.title),
    );
    const expectedClosed = new Set(
      SEED_PLAN.issues.filter((i) => i.state === "closed").map((i) => i.title),
    );
    expect(new Set(summary.openIssueTitles)).toEqual(expectedOpen);
    expect(new Set(summary.closedIssueTitles)).toEqual(expectedClosed);

    expect(summary.selfAssignedIssueCount).toBe(
      SEED_PLAN.issues.filter((i) => i.assignToSelf).length,
    );
    expect(summary.issuesWithCommentsCount).toBe(
      SEED_PLAN.issues.filter((i) => i.comments.length > 0).length,
    );

    expect(new Set(summary.pullTitles)).toEqual(
      new Set(SEED_PLAN.pullRequests.map((pr) => pr.title)),
    );

    const expectedLabeledPull = SEED_PLAN.pullRequests.find(
      (pr) => pr.labels.length > 0,
    );
    expect(expectedLabeledPull).toBeDefined();
    expect(summary.labeledPullTitles).toContain(expectedLabeledPull!.title);

    const expectedReviewedPull = SEED_PLAN.pullRequests.find(
      (pr) => pr.reviews.length > 0,
    );
    expect(expectedReviewedPull).toBeDefined();
    expect(summary.reviewedPullTitles).toContain(expectedReviewedPull!.title);
  });

  it("re-running the seed against an already-seeded repository is idempotent", async () => {
    await seedRepo(access, coords);
    const first: SeedSummary = await readSeedSummary(access, coords);

    await seedRepo(access, coords);
    const second: SeedSummary = await readSeedSummary(access, coords);

    expect(second).toEqual(first);
  });
});
