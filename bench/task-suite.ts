// The full scored task suite and the capability-asymmetric bonus definitions.
//
// The scored suite is 20 natural-language tasks drawn only from the capability
// surface every arm shares, weighted toward discovery and multi-step work; each
// task carries its tier and a scoring spec keyed on the single available user
// (see task.ts and scoring-spec.ts). The two review tasks are resolved by the
// self-review capability probe (self-review.ts): approve/request-changes where the
// host permits self-review, comment reviews otherwise, in which case the
// approve/request-changes operations fall to the bonus table instead.
//
// The bonus definitions cover the capability asymmetries kept out of the scored
// suite, in both directions: operations where gitea-axi outreaches the other arms
// and operations outside gitea-axi's scope, for which it is reported not-applicable.

import { groundTruth, SEED_PLAN } from "./seed-plan.js";
import type {
  Issue,
  PullRequest,
  RepoState,
  RequiredFact,
  ReviewKind,
  ScoringSpec,
} from "./scoring-spec.js";
import type { BenchTask } from "./task.js";

/** The number a freshly created issue receives: issues and pull requests share one seed-filled number space. */
const NEXT_ENTITY_NUMBER = SEED_PLAN.issues.length + SEED_PLAN.pullRequests.length + 1;

/** Locate a seeded issue in an expected state by its title, failing loudly if the seed lacks it. */
function issueByTitle(state: RepoState, title: string): Issue {
  const issue = state.issues.find((candidate) => candidate.title === title);
  if (issue === undefined) {
    throw new Error(`no seed issue titled "${title}"`);
  }
  return issue;
}

/** Locate a seeded pull request in an expected state by its title, failing loudly if the seed lacks it. */
function pullByTitle(state: RepoState, title: string): PullRequest {
  const pull = state.pullRequests.find((candidate) => candidate.title === title);
  if (pull === undefined) {
    throw new Error(`no seed pull request titled "${title}"`);
  }
  return pull;
}

/**
 * Build a mutation task's scoring spec as the seed's ground truth with a change
 * applied. Because `groundTruth` returns a fresh state each call, the change is
 * safe to mutate in place; the checker diffs the whole state, so anything the
 * change does not touch is asserted unchanged and any collateral edit is caught.
 */
function mutationSpec(change: (state: RepoState, user: string) => void): (user: string) => ScoringSpec {
  return (user) => {
    const expected = groundTruth(user);
    change(expected, user);
    return { kind: "mutation", expected };
  };
}

/** Whether the host permits a user to approve or request changes on their own pull request. */
export interface SuiteOptions {
  selfReviewPermitted: boolean;
}

/** A read task's scoring spec ignores the user; its required facts are seed-fixed. */
const readSpec = (facts: RequiredFact[]): (() => ScoringSpec) => () => ({ kind: "read", facts });

/** Build a review task's scoring spec: the seed with one review of the given kind added to a pull request. */
function reviewSpec(pullTitle: string, kind: ReviewKind, body: string): (user: string) => ScoringSpec {
  return mutationSpec((state, user) => {
    pullByTitle(state, pullTitle).reviews.push({ author: user, kind, body, comments: [] });
  });
}

/**
 * The four read tasks: listing/counting, label filtering, viewing one entity's
 * fields, and comment/review retrieval. Each fact's `anyOf` renderings recognise a
 * natural human answer after the checker's case- and whitespace-normalization, so
 * a correct report passes and a wrong one fails without an LLM judge. The five
 * open issues, the three bug-labelled issue titles, the labels and state of
 * "Crash when saving large files", and the seeded review body are all fixed by
 * SEED_PLAN.
 */
function readTasks(): BenchTask[] {
  return [
    {
      id: "read-open-issue-count",
      tier: "read",
      intent: "Report how many issues in this repository are currently open.",
      scoringSpec: readSpec([
        {
          description: "the repository has 5 open issues",
          anyOf: ["5 open", "five open", "open issues: 5", "open: 5", "5 issues are open"],
        },
      ]),
    },
    {
      id: "read-bug-issue-titles",
      tier: "read",
      intent: 'List the titles of every issue that carries the "bug" label, including closed ones.',
      scoringSpec: readSpec([
        { description: 'the bug issue "Fix crash on startup"', anyOf: ["Fix crash on startup"] },
        {
          description: 'the bug issue "Crash when saving large files"',
          anyOf: ["Crash when saving large files"],
        },
        { description: 'the bug issue "Crash in export dialog"', anyOf: ["Crash in export dialog"] },
      ]),
    },
    {
      id: "read-issue-labels-and-state",
      tier: "read",
      intent:
        'For the issue titled "Crash when saving large files", report which labels it carries and whether it is open or closed.',
      scoringSpec: readSpec([
        { description: 'the "bug" label', anyOf: ["bug"] },
        { description: 'the "priority" label', anyOf: ["priority"] },
        { description: "the issue is open", anyOf: ["open"] },
      ]),
    },
    {
      id: "read-review-body",
      tier: "read",
      intent:
        'Retrieve and report the body of the review left on the pull request titled "Fix startup crash".',
      scoringSpec: readSpec([
        { description: "the seeded review body", anyOf: ["the error handling could be tightened"] },
      ]),
    },
  ];
}

/** The six single-mutation tasks: close, reopen, comment, label, assign, and create. */
function singleMutationTasks(_options: SuiteOptions): BenchTask[] {
  return [
    {
      id: "close-csv-export-issue",
      tier: "single-mutation",
      intent: 'Close the issue titled "Add CSV export option". Do not modify anything else in the repository.',
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Add CSV export option").state = "closed";
      }),
    },
    {
      id: "reopen-readme-badges",
      tier: "single-mutation",
      intent: 'Reopen the issue titled "Update README badges".',
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Update README badges").state = "open";
      }),
    },
    {
      id: "comment-save-large-files",
      tier: "single-mutation",
      intent: 'Add a comment saying "I can reproduce this too." to the issue titled "Crash when saving large files".',
      scoringSpec: mutationSpec((state, user) => {
        issueByTitle(state, "Crash when saving large files").comments.push({
          author: user,
          body: "I can reproduce this too.",
        });
      }),
    },
    {
      id: "label-startup-crash",
      tier: "single-mutation",
      intent: 'Add the "priority" label to the issue titled "Fix crash on startup".',
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Fix crash on startup").labels.push("priority");
      }),
    },
    {
      id: "assign-install-docs-typo",
      tier: "single-mutation",
      intent: 'Assign the issue titled "Typo in installation docs" to yourself.',
      scoringSpec: mutationSpec((state, user) => {
        issueByTitle(state, "Typo in installation docs").assignees.push(user);
      }),
    },
    {
      id: "create-memory-leak-issue",
      tier: "single-mutation",
      intent:
        'Create a new issue titled "Investigate memory leak" with the body "Memory usage grows unbounded during long export runs."',
      scoringSpec: mutationSpec((state) => {
        state.issues.push({
          number: NEXT_ENTITY_NUMBER,
          title: "Investigate memory leak",
          body: "Memory usage grows unbounded during long export runs.",
          state: "open",
          labels: [],
          assignees: [],
          comments: [],
        });
      }),
    },
  ];
}

/** The six find-then-act tasks: each names its target by a property, not its title. */
function findThenActTasks(options: SuiteOptions): BenchTask[] {
  const reviewVerbA = options.selfReviewPermitted ? "approve it" : "leave a review";
  const reviewVerbB = options.selfReviewPermitted ? "request changes on it" : "leave a review";
  return [
    {
      id: "fta-reopen-unlabelled-closed",
      tier: "find-then-act",
      intent: "Find the closed issue that has no labels and reopen it.",
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Typo in error message").state = "open";
      }),
    },
    {
      id: "fta-label-export-dialog-crash",
      tier: "find-then-act",
      intent:
        'Among the issues about crashes, find the one about the export dialog and add the "priority" label to it.',
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Crash in export dialog").labels.push("priority");
      }),
    },
    {
      id: "fta-merge-startup-pull",
      tier: "find-then-act",
      intent: "Find the open pull request that fixes the startup crash and merge it.",
      scoringSpec: mutationSpec((state) => {
        pullByTitle(state, "Fix startup crash").state = "merged";
      }),
    },
    {
      id: "fta-edit-install-docs-typo",
      tier: "find-then-act",
      intent:
        `Find the issue about a typo in the installation documentation and change its body to "The install guide says 'yarn' in the setup step where it should say 'npm'."`,
      scoringSpec: mutationSpec((state) => {
        issueByTitle(state, "Typo in installation docs").body =
          "The install guide says 'yarn' in the setup step where it should say 'npm'.";
      }),
    },
    {
      id: "fta-review-csv-pull",
      tier: "find-then-act",
      intent:
        `Find the pull request that implements CSV export and ${reviewVerbA} with the review comment "The CSV export path looks correct to me."`,
      scoringSpec: reviewSpec(
        "Implement CSV export",
        options.selfReviewPermitted ? "approved" : "comment",
        "The CSV export path looks correct to me.",
      ),
    },
    {
      id: "fta-review-docs-pull",
      tier: "find-then-act",
      intent:
        `Find the pull request that refreshes the documentation and ${reviewVerbB} with the review comment "Please expand the installation section before this merges."`,
      scoringSpec: reviewSpec(
        "Refresh documentation",
        options.selfReviewPermitted ? "request-changes" : "comment",
        "Please expand the installation section before this merges.",
      ),
    },
  ];
}

/** The four multi-step workflows: each applies several mutations in one task. */
function multiStepTasks(_options: SuiteOptions): BenchTask[] {
  return [
    {
      id: "ms-triage-export-perf",
      tier: "multi-step",
      intent:
        'Triage the issue titled "Improve export performance": add the "priority" label, assign it to yourself, and leave a comment "Prioritised for the next sprint."',
      scoringSpec: mutationSpec((state, user) => {
        const issue = issueByTitle(state, "Improve export performance");
        issue.labels.push("priority");
        issue.assignees.push(user);
        issue.comments.push({ author: user, body: "Prioritised for the next sprint." });
      }),
    },
    {
      id: "ms-close-open-crashes",
      tier: "multi-step",
      intent:
        'For every open issue whose title mentions a crash, add the comment "Consolidating crash reports." and then close it.',
      scoringSpec: mutationSpec((state, user) => {
        for (const issue of state.issues) {
          if (issue.state === "open" && /crash/i.test(issue.title)) {
            issue.comments.push({ author: user, body: "Consolidating crash reports." });
            issue.state = "closed";
          }
        }
      }),
    },
    {
      id: "ms-create-and-apply-stale",
      tier: "multi-step",
      intent:
        'Create a new label named "stale" with colour #cccccc, apply it to the issue titled "Add CSV export option", and then close that issue.',
      scoringSpec: mutationSpec((state) => {
        state.labels = [...state.labels, { name: "stale", color: "#cccccc" }];
        const issue = issueByTitle(state, "Add CSV export option");
        issue.labels.push("stale");
        issue.state = "closed";
      }),
    },
    {
      id: "ms-reopen-assign-comment-badges",
      tier: "multi-step",
      intent:
        'Reopen the issue titled "Update README badges", assign it to yourself, and add a comment "Reopening to refresh the badge URLs."',
      scoringSpec: mutationSpec((state, user) => {
        const issue = issueByTitle(state, "Update README badges");
        issue.state = "open";
        issue.assignees.push(user);
        issue.comments.push({ author: user, body: "Reopening to refresh the badge URLs." });
      }),
    },
  ];
}

/** Build the 20-task scored suite; the two review tasks reflect self-review support. */
export function buildScoredSuite(options: SuiteOptions): BenchTask[] {
  return [
    ...readTasks(),
    ...singleMutationTasks(options),
    ...findThenActTasks(options),
    ...multiStepTasks(options),
  ];
}

/** Which side of gitea-axi a bonus operation's capability asymmetry favours. */
export type BonusDirection =
  | "gitea-axi-advantage"
  | "gitea-axi-not-applicable"
  | "self-review-unavailable";

/** Whether a given arm can perform an operation at all. */
export type Applicability = "applicable" | "not-applicable";

/** One capability-asymmetric operation reported in the bonus table, kept out of the scored suite. */
export interface BonusTask {
  id: string;
  operation: string;
  direction: BonusDirection;
  note: string;
  /** gitea-axi's own applicability for this operation. */
  giteaAxi: Applicability;
}

/**
 * The static capability-asymmetric bonus definitions, in both directions. The
 * first group is where the other arms fall short of gitea-axi — full-text search,
 * pull-request diff, checks, checkout, and issue dependencies — so gitea-axi is
 * applicable and the asymmetry is its advantage. The second is outside gitea-axi's
 * command surface entirely — repository, release, and milestone management — so
 * gitea-axi is reported not-applicable. All are kept out of the scored suite (their
 * ids share no namespace with it) so the headline comparison stays on the shared
 * surface.
 */
const STATIC_BONUS: BonusTask[] = [
  {
    id: "bonus-full-text-search",
    operation: 'Search every issue for the word "crash" using full-text search and report the matches.',
    direction: "gitea-axi-advantage",
    note: "gitea-axi exposes the issue full-text search endpoint ergonomically; the other arms have no first-class equivalent.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-pull-request-diff",
    operation: 'Show the file diff proposed by the pull request titled "Implement CSV export".',
    direction: "gitea-axi-advantage",
    note: "gitea-axi renders a pull request's diff directly; the other arms must reconstruct it from raw endpoints or git.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-pull-request-checks",
    operation: 'Report the CI checks status of the pull request titled "Fix startup crash".',
    direction: "gitea-axi-advantage",
    note: "gitea-axi surfaces a pull request's commit-status checks; the other arms lack a dedicated affordance.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-pull-request-checkout",
    operation: 'Checkout the head branch of the pull request titled "Refresh documentation" to inspect it locally.',
    direction: "gitea-axi-advantage",
    note: "gitea-axi resolves a pull request to its head branch for checkout; the other arms leave this to manual git.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-issue-dependencies",
    operation: 'Add an issue dependency so that "Add CSV export option" depends on "Improve export performance".',
    direction: "gitea-axi-advantage",
    note: "gitea-axi manages issue dependencies; the other arms do not model them.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-repository-management",
    operation: 'Create a new repository named "archive-2026" under the current user.',
    direction: "gitea-axi-not-applicable",
    note: "Repository management is outside gitea-axi's command surface; it is reported not-applicable.",
    giteaAxi: "not-applicable",
  },
  {
    id: "bonus-release-management",
    operation: 'Publish a release tagged "v1.0.0" with notes on the repository.',
    direction: "gitea-axi-not-applicable",
    note: "Release management is outside gitea-axi's command surface; it is reported not-applicable.",
    giteaAxi: "not-applicable",
  },
  {
    id: "bonus-milestone-management",
    operation: 'Create a milestone "v2.0" and attach the open enhancement issues to it.',
    direction: "gitea-axi-not-applicable",
    note: "Milestone management is outside gitea-axi's command surface; it is reported not-applicable.",
    giteaAxi: "not-applicable",
  },
];

/**
 * The self-review pair, reported in the bonus table only when the host forbids a
 * user from approving or requesting changes on their own pull request. When
 * self-review is permitted these are scored directly (the two review tasks are
 * promoted, see findThenActTasks), so they are absent from the bonus table then.
 * The operation is within gitea-axi's own reach — the limitation is the host's, not
 * the tool's — so gitea-axi is applicable.
 */
const SELF_REVIEW_BONUS: BonusTask[] = [
  {
    id: "bonus-approve-own-pull",
    operation: 'Approve your own pull request titled "Implement CSV export".',
    direction: "self-review-unavailable",
    note: "The host forbids approving one's own pull request, so no arm can perform it; the scored suite substitutes a comment review.",
    giteaAxi: "applicable",
  },
  {
    id: "bonus-request-changes-own-pull",
    operation: 'Request changes on your own pull request titled "Refresh documentation".',
    direction: "self-review-unavailable",
    note: "The host forbids requesting changes on one's own pull request, so no arm can perform it; the scored suite substitutes a comment review.",
    giteaAxi: "applicable",
  },
];

/** The bonus definitions; the self-review pair is appended when self-review is unavailable. */
export function buildBonusTasks(options: SuiteOptions): BonusTask[] {
  return [...STATIC_BONUS, ...(options.selfReviewPermitted ? [] : SELF_REVIEW_BONUS)];
}
