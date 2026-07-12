import type { PullReview } from "gitea-js";
import type { GiteaClient } from "./client.js";
import type { RepoContext } from "./context.js";
import { classifyHttpError } from "./errors.js";

/**
 * gitea-axi's reviewDecision, the three-value result of {@link reviewDecision}.
 * Deliberately narrower than gh-axi's four values: Gitea offers no non-admin way
 * to tell whether review is formally required, so there is no `none` (ADR 0006).
 */
export type ReviewDecision = "approved" | "changes_requested" | "required";

// Gitea's ReviewStateType is typed as a bare string; these are the two states
// the decision turns on. A comment-only or pending review is neither, so it
// falls through to `required`.
const APPROVED = "APPROVED";
const REQUEST_CHANGES = "REQUEST_CHANGES";

/**
 * Derive a PR's reviewDecision from its reviews, using the official-first
 * fallback (ADR 0006): when any review is `official`, only official reviews
 * count — preserving branch-protection semantics; otherwise every review counts,
 * since unprotected repos never mark a review official and `approved` would
 * otherwise be unreachable there.
 *
 * Within the considered set: a non-dismissed `REQUEST_CHANGES` wins as
 * `changes_requested`; else a non-dismissed, non-stale `APPROVED` is `approved`;
 * everything else — zero reviews, comment-only, stale or dismissed approvals —
 * is `required`.
 */
export function reviewDecision(reviews: PullReview[]): ReviewDecision {
  const hasOfficial = reviews.some((review) => review.official === true);
  const considered = hasOfficial
    ? reviews.filter((review) => review.official === true)
    : reviews;

  if (considered.some((review) => review.state === REQUEST_CHANGES && !review.dismissed)) {
    return "changes_requested";
  }
  if (
    considered.some(
      (review) => review.state === APPROVED && !review.stale && !review.dismissed,
    )
  ) {
    return "approved";
  }
  return "required";
}

/**
 * Fetch a PR's reviews and reduce them to its reviewDecision. One HTTP call per
 * PR — `pr list` issues these in parallel across the rows it renders (ADR 0006).
 */
export async function fetchReviewDecision(
  api: GiteaClient,
  context: RepoContext,
  number: number,
): Promise<ReviewDecision> {
  let reviews: PullReview[];
  try {
    const response = await api.repos.repoListPullReviews(context.owner, context.name, number);
    reviews = response.data ?? [];
  } catch (error) {
    throw classifyHttpError(error);
  }
  return reviewDecision(reviews);
}
