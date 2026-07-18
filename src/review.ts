import type { PullReview, PullReviewComment } from "gitea-js";
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
 * Fetch a PR's reviews. One HTTP call per PR — `pr list` issues these in
 * parallel across the rows it renders, and `pr view` fetches them alongside the
 * PR itself (ADR 0006).
 */
export async function fetchReviews(
  api: GiteaClient,
  context: RepoContext,
  number: number,
): Promise<PullReview[]> {
  try {
    const response = await api.repos.repoListPullReviews(context.owner, context.name, number);
    return response.data ?? [];
  } catch (error) {
    throw classifyHttpError(error);
  }
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
  return reviewDecision(await fetchReviews(api, context, number));
}

/**
 * Fetch a single review's inline (diff) comments. `pr view --reviews` issues one
 * of these per review, in parallel, to attach each review's comments to it.
 */
export async function fetchReviewComments(
  api: GiteaClient,
  context: RepoContext,
  number: number,
  reviewId: number,
): Promise<PullReviewComment[]> {
  try {
    const response = await api.repos.repoGetPullReviewComments(
      context.owner,
      context.name,
      number,
      reviewId,
    );
    return response.data ?? [];
  } catch (error) {
    throw classifyHttpError(error);
  }
}

/**
 * Every inline review comment on a PR, flattened across all its reviews. Gitea
 * has no get-comment-by-id endpoint, so the write side's reply path uses this
 * reviews-plus-comments fan-out — the same one `pr view --reviews` performs — to
 * locate a reply's target comment by id.
 */
export async function fetchAllReviewComments(
  api: GiteaClient,
  context: RepoContext,
  number: number,
): Promise<PullReviewComment[]> {
  const reviews = await fetchReviews(api, context, number);
  const lists = await Promise.all(
    reviews.map((review) =>
      review.id !== undefined
        ? fetchReviewComments(api, context, number, review.id)
        : Promise.resolve<PullReviewComment[]>([]),
    ),
  );
  return lists.flat();
}
