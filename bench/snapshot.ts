// Post-run snapshot capture: read the entire scored surface of a live throwaway
// repository back into the `RepoState` shape the checker diffs against. This is
// the runner's counterpart to the seed — the seed writes the ground truth, this
// reads the actual post-run state — so a mutation task can be scored by the
// full-state diff (checker.ts) and any collateral change is caught.
//
// Like seed.ts, this is an imperative live boundary: its value is the real Gitea
// API interaction, so it is exercised by the smoke run rather than mocked unit
// tests. It reuses seed.ts's authenticated `send` helper so reads and writes share
// one round-trip, and normalizes the few fields whose live representation differs
// from the declared ground truth (notably label colours, which Gitea returns as
// bare hex without the leading `#`).

import { send, type BenchAccess, type RepoCoords } from "./seed.js";
import type {
  Comment,
  Issue,
  IssueState,
  Label,
  PullRequest,
  PullRequestState,
  RepoState,
  Review,
  ReviewKind,
} from "./scoring-spec.js";

interface GiteaLabel {
  name: string;
  color: string;
  description?: string;
}

interface GiteaComment {
  body: string;
  user: { login: string };
}

interface GiteaIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string }[] | null;
  assignees: { login: string }[] | null;
}

interface GiteaPull {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  labels: { name: string }[] | null;
  assignees: { login: string }[] | null;
}

interface GiteaReview {
  user: { login: string };
  state: string;
  body: string;
}

/** Colours compare against the declared ground truth's leading-`#` lowercase hex. */
function normalizeColor(color: string): string {
  const bare = color.replace(/^#/, "").toLowerCase();
  return `#${bare}`;
}

/** Gitea's applied-label and assignee arrays are nullable; reduce to name/login sets. */
function labelNames(labels: { name: string }[] | null): string[] {
  return (labels ?? []).map((label) => label.name);
}

function assigneeLogins(assignees: { login: string }[] | null): string[] {
  return (assignees ?? []).map((assignee) => assignee.login);
}

/** Map a Gitea comment to the author/body pair the checker matches on. */
function toComment(comment: GiteaComment): Comment {
  return { author: comment.user.login, body: comment.body };
}

/** The Gitea review `state` verbs that map to a scored review kind; others are ignored. */
const REVIEW_KIND: Record<string, ReviewKind> = {
  APPROVED: "approved",
  REQUEST_CHANGES: "request-changes",
  COMMENT: "comment",
};

/** Read the comments (author and body) on an issue or pull request by number. */
async function captureComments(
  access: BenchAccess,
  coords: RepoCoords,
  number: number,
): Promise<Comment[]> {
  const comments = await send<GiteaComment[]>(
    access,
    "GET",
    `/repos/${coords.owner}/${coords.repo}/issues/${number}/comments`,
  );
  return comments.map(toComment);
}

/**
 * Read a pull request's reviews, keeping only those whose Gitea state maps to a
 * scored review kind (a bare pending or review-request entry is dropped). Inline
 * review comments are left empty, matching the declared ground truth, which the
 * single-user seed never populates with inline comments.
 */
async function captureReviews(
  access: BenchAccess,
  coords: RepoCoords,
  number: number,
): Promise<Review[]> {
  const reviews = await send<GiteaReview[]>(
    access,
    "GET",
    `/repos/${coords.owner}/${coords.repo}/pulls/${number}/reviews`,
  );
  const captured: Review[] = [];
  for (const review of reviews) {
    const kind = REVIEW_KIND[review.state];
    if (kind === undefined) {
      continue;
    }
    captured.push({ author: review.user.login, kind, body: review.body, comments: [] });
  }
  return captured;
}

/**
 * Capture the full post-run state of a throwaway repository — its labels, issues,
 * and pull requests with their applied labels, assignees, comments, and reviews —
 * in the shape the checker scores against. The volatile ids and timestamps the
 * ground truth drops are simply never read.
 */
export async function captureRepoState(
  access: BenchAccess,
  coords: RepoCoords,
): Promise<RepoState> {
  const base = `/repos/${coords.owner}/${coords.repo}`;

  const rawLabels = await send<GiteaLabel[]>(access, "GET", `${base}/labels?limit=100`);
  const labels: Label[] = rawLabels.map((label) => ({
    name: label.name,
    color: normalizeColor(label.color),
    ...(label.description ? { description: label.description } : {}),
  }));

  const rawIssues = await send<GiteaIssue[]>(
    access,
    "GET",
    `${base}/issues?type=issues&state=all&limit=100`,
  );
  const issues: Issue[] = [];
  for (const issue of rawIssues) {
    issues.push({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state as IssueState,
      labels: labelNames(issue.labels),
      assignees: assigneeLogins(issue.assignees),
      comments: await captureComments(access, coords, issue.number),
    });
  }

  const rawPulls = await send<GiteaPull[]>(access, "GET", `${base}/pulls?state=all&limit=100`);
  const pullRequests: PullRequest[] = [];
  for (const pull of rawPulls) {
    const state: PullRequestState = pull.merged ? "merged" : (pull.state as PullRequestState);
    pullRequests.push({
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state,
      labels: labelNames(pull.labels),
      assignees: assigneeLogins(pull.assignees),
      comments: await captureComments(access, coords, pull.number),
      reviews: await captureReviews(access, coords, pull.number),
    });
  }

  return { labels, issues, pullRequests };
}
