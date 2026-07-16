// The seed plan: the deterministic ground truth every throwaway repository is
// brought to before a trial runs. It is pure declarative data — a fixed set of
// labels, a spread of issues, and a handful of pull requests — parametrized only
// by the single available user, whose identity fills the assignee and author
// dimensions the single-user seed collapses onto (see the single-user-seed ADR).
//
// Because only one Gitea account is available, the discriminating dimensions are
// label, state, assignee presence (assigned-to-self versus unassigned), and title
// keyword — not author. `groundTruth` realizes the plan into the RepoState the
// checker scores against, assigning the deterministic issue and pull-request
// numbers a fresh repository hands out in creation order.
//
// The live seeding that applies this plan lives in seed.ts and is validated by a
// smoke run, not by mocked unit tests (see the benchmark-harness spec's testing
// decisions).

import type { RepoState, ReviewKind } from "./scoring-spec.js";

/** A repository label the seed fixes, with its stable colour. */
export interface SeedLabel {
  name: string;
  color: string;
  description?: string;
}

/**
 * One issue in the plan. `assignToSelf` picks the assignee-presence dimension
 * (the single user or nobody); `comments` are bodies the single user authors.
 */
export interface SeedIssue {
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignToSelf: boolean;
  comments: string[];
}

/** One review the seed leaves on a pull request; the single user is the author. */
export interface SeedReview {
  kind: ReviewKind;
  body: string;
}

/**
 * One pull request in the plan, always backed by a real feature branch carrying
 * one file so the pull request has a genuine diff to propose.
 */
export interface SeedPullRequest {
  title: string;
  body: string;
  headBranch: string;
  filePath: string;
  fileContent: string;
  labels: string[];
  comments: string[];
  reviews: SeedReview[];
}

/** The whole deterministic seed: labels, issues, and pull requests. */
export interface SeedPlan {
  labels: SeedLabel[];
  issues: SeedIssue[];
  pullRequests: SeedPullRequest[];
}

export const SEED_PLAN: SeedPlan = {
  labels: [
    { name: "bug", color: "#d73a4a", description: "Something is broken" },
    { name: "enhancement", color: "#a2eeef", description: "A new feature or request" },
    { name: "documentation", color: "#0075ca", description: "Docs and readme changes" },
    { name: "priority", color: "#b60205", description: "Needs attention soon" },
  ],
  issues: [
    {
      title: "Fix crash on startup",
      body: "The app crashes immediately on a fresh launch.",
      state: "open",
      labels: ["bug"],
      assignToSelf: true,
      comments: ["I can reproduce this on Linux."],
    },
    {
      title: "Add CSV export option",
      body: "Users want to export their data as CSV.",
      state: "open",
      labels: ["enhancement"],
      assignToSelf: false,
      comments: [],
    },
    {
      title: "Crash when saving large files",
      body: "Saving a file over about 100 MB reliably crashes the editor.",
      state: "open",
      labels: ["bug", "priority"],
      assignToSelf: true,
      comments: [],
    },
    {
      title: "Typo in installation docs",
      body: "The install guide says 'yarn' where it should say 'npm'.",
      state: "open",
      labels: ["documentation"],
      assignToSelf: false,
      comments: ["Found another typo nearby."],
    },
    {
      title: "Update README badges",
      body: "The build badges in the README point at the old CI.",
      state: "closed",
      labels: ["documentation"],
      assignToSelf: false,
      comments: [],
    },
    {
      title: "Crash in export dialog",
      body: "Opening the export dialog twice crashes the app.",
      state: "closed",
      labels: ["bug"],
      assignToSelf: true,
      comments: [],
    },
    {
      title: "Improve export performance",
      body: "Exporting a large project is slow and blocks the UI.",
      state: "open",
      labels: ["enhancement"],
      assignToSelf: false,
      comments: [],
    },
    {
      title: "Typo in error message",
      body: "The save-failed dialog misspells 'occurred'.",
      state: "closed",
      labels: [],
      assignToSelf: false,
      comments: [],
    },
  ],
  pullRequests: [
    {
      title: "Implement CSV export",
      body: "Adds the CSV export path requested in the issues.",
      headBranch: "feature/csv-export",
      filePath: "export.txt",
      fileContent: "CSV export implementation notes.\n",
      labels: ["enhancement"],
      comments: [],
      reviews: [],
    },
    {
      title: "Fix startup crash",
      body: "Guards the startup path that was throwing on a fresh launch.",
      headBranch: "feature/fix-crash",
      filePath: "fix.txt",
      fileContent: "Startup crash fix notes.\n",
      labels: [],
      comments: [],
      reviews: [
        {
          kind: "comment",
          body: "Looks good overall, though the error handling could be tightened.",
        },
      ],
    },
    {
      title: "Refresh documentation",
      body: "Updates the README and installation guide.",
      headBranch: "feature/docs-refresh",
      filePath: "docs.txt",
      fileContent: "Documentation refresh notes.\n",
      labels: [],
      comments: ["Ready for review."],
      reviews: [],
    },
  ],
};

/**
 * Realize the plan into the ground-truth RepoState for the given single user,
 * assigning the deterministic numbers a freshly provisioned repository hands out:
 * issues first in plan order, then pull requests, sharing one number space.
 */
export function groundTruth(user: string): RepoState {
  const authored = (body: string) => ({ author: user, body });
  const issues = SEED_PLAN.issues.map((issue, index) => ({
    number: index + 1,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: [...issue.labels],
    assignees: issue.assignToSelf ? [user] : [],
    comments: issue.comments.map(authored),
  }));
  const pullRequests = SEED_PLAN.pullRequests.map((pr, index) => ({
    number: SEED_PLAN.issues.length + index + 1,
    title: pr.title,
    body: pr.body,
    state: "open" as const,
    labels: [...pr.labels],
    assignees: [],
    comments: pr.comments.map(authored),
    reviews: pr.reviews.map((review) => ({
      author: user,
      kind: review.kind,
      body: review.body,
      comments: [],
    })),
  }));
  return { labels: SEED_PLAN.labels, issues, pullRequests };
}
