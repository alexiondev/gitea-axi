// The self-review capability probe: whether the live host permits a user to
// approve or request changes on their own pull request. The single-user seed can
// always leave a comment-type review on its own pull request, but approve and
// request-changes are host-gated — Gitea can be configured either way — so the
// scored suite's two review tasks must be resolved against the real host before a
// sweep: promoted to approve/request-changes where self-review is permitted, left
// as comment reviews otherwise (see task-suite.ts).
//
// This is a live boundary, like seed.ts and snapshot.ts: its value is the real
// Gitea API interaction, so it is exercised by the smoke run rather than mocked.

import {
  deleteRepo,
  provisionRepo,
  request,
  seedRepo,
  type BenchAccess,
  type RepoCoords,
} from "./seed.js";
import { SEED_PLAN } from "./seed-plan.js";

/**
 * Attempt an approving review on one of the pull requests authored by the single
 * available user, returning whether the host accepted it. A 2xx means self-review
 * is permitted; a 4xx (the host forbidding self-approval) means it is not. A
 * network-level failure propagates rather than being read as "not permitted", so a
 * transient error never silently downgrades the scored suite.
 */
export async function probeSelfReview(
  access: BenchAccess,
  coords: RepoCoords,
  prNumber: number,
): Promise<boolean> {
  const res = await request(
    access,
    "POST",
    `/repos/${coords.owner}/${coords.repo}/pulls/${prNumber}/reviews`,
    { event: "APPROVED", body: "self-review capability probe" },
  );
  return res.ok;
}

/**
 * Detect self-review support end to end against the live host: provision a
 * throwaway repository, seed it to the ground truth (which creates the pull
 * requests), probe an approval on the first seeded pull request, and delete the
 * repository. The first pull request's number is deterministic — issues are seeded
 * before pull requests in one shared number space — so it is the issue count plus
 * one. Returns the probe's verdict for the suite builder to consume once per sweep.
 */
export async function detectSelfReviewSupport(access: BenchAccess): Promise<boolean> {
  const coords = await provisionRepo(access);
  try {
    await seedRepo(access, coords);
    const firstPullNumber = SEED_PLAN.issues.length + 1;
    return await probeSelfReview(access, coords, firstPullNumber);
  } finally {
    await deleteRepo(access, coords);
  }
}
