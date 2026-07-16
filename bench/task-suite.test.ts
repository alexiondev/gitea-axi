import { describe, expect, it } from "vitest";
import { buildScoredSuite, buildBonusTasks } from "./task-suite.js";
import { checkReadAnswer, checkMutation } from "./checker.js";
import { SEED_PLAN, groundTruth } from "./seed-plan.js";
import type { Tier } from "./result.js";

/**
 * The shape of the scored suite, asserted against the acceptance criteria as
 * independent literals — NOT recomputed from the returned array. The criteria
 * (benchmark-harness spec) fix the suite at 20 tasks, weighted roughly four
 * read / six single-mutation / six find-then-act / four multi-step, each task
 * carrying a tier tag and a scoring spec. So:
 *  - the total is exactly 20 (a hard literal from the criteria);
 *  - the per-tier counts are exactly 4 / 6 / 6 / 4 (hard literals);
 *  - every task has a unique, non-empty id and a non-empty intent (a runnable
 *    task must name itself and carry an instruction for the agent);
 *  - the scoring-spec kind follows the fixed tier semantics: read-tier tasks are
 *    scored by the required facts in their report (kind "read"), while the three
 *    acting tiers are scored by their expected end state (kind "mutation").
 * The tier→kind rule and the counts are the source of truth here, held as
 * literals below, not derived from buildScoredSuite's own output.
 */
const EXPECTED_TOTAL = 20;
const EXPECTED_COUNT_BY_TIER: Record<Tier, number> = {
  read: 4,
  "single-mutation": 6,
  "find-then-act": 6,
  "multi-step": 4,
};

// The fixed tier→scoring-spec-kind rule: a read task is scored on the facts its
// report must contain; the three acting tiers are scored on the repository's
// expected end state.
const EXPECTED_KIND_BY_TIER: Record<Tier, "read" | "mutation"> = {
  read: "read",
  "single-mutation": "mutation",
  "find-then-act": "mutation",
  "multi-step": "mutation",
};

// An arbitrary single available user for the scoring-spec factory; its exact
// value is irrelevant to the structural facts under test.
const USER = "benchbot";

// Build a post-run state that pushes one review of the given kind onto the named
// pull request, independently from groundTruth + the seed. Shared by the review
// tasks' tests (self-review permitted and not permitted alike).
const stateWithReview = (
  pullTitle: string,
  review: { kind: "comment" | "approved" | "request-changes"; body: string },
) => {
  const baseline = groundTruth(USER);
  return {
    ...baseline,
    pullRequests: baseline.pullRequests.map((pull) =>
      pull.title === pullTitle
        ? {
            ...pull,
            reviews: [
              ...pull.reviews,
              { author: USER, kind: review.kind, body: review.body, comments: [] },
            ],
          }
        : pull,
    ),
  };
};

describe("buildScoredSuite", () => {
  it("returns 20 tier-tagged tasks weighted 4 read / 6 single-mutation / 6 find-then-act / 4 multi-step, each with a unique id, an intent, and a tier-appropriate scoring spec", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    // Exactly 20 tasks.
    expect(suite).toHaveLength(EXPECTED_TOTAL);

    // Exact tier distribution.
    const countByTier = (tier: Tier) => suite.filter((task) => task.tier === tier).length;
    expect(countByTier("read")).toBe(EXPECTED_COUNT_BY_TIER.read);
    expect(countByTier("single-mutation")).toBe(EXPECTED_COUNT_BY_TIER["single-mutation"]);
    expect(countByTier("find-then-act")).toBe(EXPECTED_COUNT_BY_TIER["find-then-act"]);
    expect(countByTier("multi-step")).toBe(EXPECTED_COUNT_BY_TIER["multi-step"]);

    // Every task names itself (uniquely) and carries an instruction.
    const ids = suite.map((task) => task.id);
    expect(new Set(ids).size).toBe(EXPECTED_TOTAL);
    for (const task of suite) {
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.intent.length).toBeGreaterThan(0);
    }

    // Every task's scoring spec is a factory whose kind matches its tier.
    for (const task of suite) {
      const spec = task.scoringSpec(USER);
      expect(spec.kind).toBe(EXPECTED_KIND_BY_TIER[task.tier]);
    }
  });
});

// The true open-issue count, derived independently from the seed plan's declared
// ground truth (bench/seed-plan.ts) rather than read back from task-suite.ts.
// This tracks the plan: if the seed's open/closed spread changes, so does the
// expected answer.
const SEED_OPEN_ISSUE_COUNT = SEED_PLAN.issues.filter((issue) => issue.state === "open").length;

describe("buildScoredSuite read-task scoring specs", () => {
  // Behavior: a read task's scoring spec is a read-type spec whose required facts
  // encode the seed's ground truth, so the checker accepts a report that states
  // the true answer and rejects one that states a wrong answer (benchmark-harness
  // spec, "read tasks scored by required facts, no LLM judge"). We assert this
  // through the real public checker (checkReadAnswer), not by inspecting the fact
  // strings, so the test survives any rephrasing of the fact renderings. The
  // open-issue count is an independent literal computed from SEED_PLAN above.
  it("grounds the open-issue-count read task's facts in the seed so the checker accepts the true count and rejects a wrong one", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    const task = suite.find((candidate) => candidate.id === "read-open-issue-count");
    expect(task).toBeDefined();
    if (task === undefined) return;

    const spec = task.scoringSpec(USER);
    expect(spec.kind).toBe("read");
    if (spec.kind !== "read") return;

    const correctReport = `There are ${SEED_OPEN_ISSUE_COUNT} open issues in the repository.`;
    const wrongCount = SEED_OPEN_ISSUE_COUNT + 3;
    const wrongReport = `There are ${wrongCount} open issues in the repository.`;

    expect(checkReadAnswer(spec.facts, correctReport).pass).toBe(true);
    expect(checkReadAnswer(spec.facts, wrongReport).pass).toBe(false);
  });
});

// The title of the CLOSED seeded issue the reopen task targets, taken from
// SEED_PLAN (bench/seed-plan.ts) as the source of truth: "Update README badges"
// is seeded state "closed". The task's purpose is to reopen exactly that issue.
const REOPEN_TARGET_TITLE = "Update README badges";

describe("buildScoredSuite single-mutation scoring specs", () => {
  // Behavior: a single-mutation task's expected end state is the seed's ground
  // truth with only the one described change applied — the intended mutation is
  // present and nothing else is altered, so the full-state diff catches both a
  // missed change and collateral damage (benchmark-harness spec, "mutation tasks
  // scored by expected end state, diffed in full"). We assert this through the
  // real public checker (checkMutation) against a baseline we build independently
  // from groundTruth + the seed, never from task-suite.ts:
  //  - the expected state accepts a post-run state that reopens ONLY the target
  //    issue (intended mutation present, nothing else changed);
  //  - the expected state rejects the untouched ground truth, proving the spec
  //    actually encodes the reopen rather than being the identity.
  it("encodes reopening only the target issue: matches the reopened state and rejects the untouched seed", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    const task = suite.find((candidate) => candidate.id === "reopen-readme-badges");
    expect(task).toBeDefined();
    if (task === undefined) return;

    const spec = task.scoringSpec(USER);
    expect(spec.kind).toBe("mutation");
    if (spec.kind !== "mutation") return;

    // Build the post-run state independently: the seed ground truth with ONLY the
    // target issue flipped from closed to open, every other field untouched.
    const baseline = groundTruth(USER);
    const reopenedState = {
      ...baseline,
      issues: baseline.issues.map((issue) =>
        issue.title === REOPEN_TARGET_TITLE ? { ...issue, state: "open" as const } : issue,
      ),
    };

    // Intended mutation present, nothing else altered → the spec accepts it.
    expect(checkMutation(spec.expected, reopenedState).pass).toBe(true);

    // The spec is not the identity: it does not accept the untouched seed, where
    // the target issue is still closed.
    expect(checkMutation(spec.expected, groundTruth(USER)).pass).toBe(false);
  });
});

// The seeded title of the pull request the find-then-act merge task targets,
// taken from SEED_PLAN (bench/seed-plan.ts) as the source of truth: the pull
// request "Fix startup crash" is seeded open, and the task's purpose is to merge
// exactly that one. This literal doubles as the string the intent must NOT hand
// over verbatim.
const FTA_TARGET_PULL_TITLE = "Fix startup crash";

describe("buildScoredSuite find-then-act scoring specs", () => {
  // Behavior: a find-then-act task forces discovery — it names its target by a
  // property, not by the exact seeded title — and its scoring spec encodes the
  // single acting change against the uniquely-matching seed entity (benchmark-
  // harness spec, "find-then-act tier"). We assert both halves:
  //  - the intent does NOT contain the exact target title, so the agent must find
  //    the pull request rather than being handed it;
  //  - through the real public checker (checkMutation) against a baseline built
  //    independently from groundTruth + the seed, the expected state accepts a
  //    post-run state that merges ONLY the target pull request (intended change
  //    present, nothing else altered) and rejects the untouched seed (not the
  //    identity).
  it("describes the merge target by property (not verbatim title) and encodes merging only that pull request", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    const task = suite.find((candidate) => candidate.id === "fta-merge-startup-pull");
    expect(task).toBeDefined();
    if (task === undefined) return;

    expect(task.tier).toBe("find-then-act");

    // Discovery is forced: the exact seeded title is not handed over in the intent.
    expect(task.intent.includes(FTA_TARGET_PULL_TITLE)).toBe(false);

    const spec = task.scoringSpec(USER);
    expect(spec.kind).toBe("mutation");
    if (spec.kind !== "mutation") return;

    // Build the post-run state independently: the seed ground truth with ONLY the
    // target pull request set to merged, every other field/entity untouched.
    const baseline = groundTruth(USER);
    const mergedState = {
      ...baseline,
      pullRequests: baseline.pullRequests.map((pull) =>
        pull.title === FTA_TARGET_PULL_TITLE ? { ...pull, state: "merged" as const } : pull,
      ),
    };

    // Intended merge present, nothing else altered → the spec accepts it.
    expect(checkMutation(spec.expected, mergedState).pass).toBe(true);

    // The spec is not the identity: it rejects the untouched seed, where the
    // target pull request is still open.
    expect(checkMutation(spec.expected, groundTruth(USER)).pass).toBe(false);
  });
});

// The seeded issue the multi-step triage task targets and the three changes it
// applies at once, from SEED_PLAN (bench/seed-plan.ts) and the task's stated
// purpose as the source of truth: "Improve export performance" is seeded open
// with labels ["enhancement"], no assignees, no comments; triage adds the
// "priority" label, assigns it to the user, and adds one comment.
const MS_TARGET_ISSUE_TITLE = "Improve export performance";
const MS_ADDED_LABEL = "priority";
const MS_ADDED_COMMENT_BODY = "Prioritised for the next sprint.";

describe("buildScoredSuite multi-step scoring specs", () => {
  // Behavior: a multi-step task's expected end state encodes ALL of its several
  // changes together against the seed ground truth, and nothing else (benchmark-
  // harness spec, "multi-step tier"). We assert through the real public checker
  // (checkMutation) against baselines built independently from groundTruth + the
  // seed:
  //  - the expected state accepts a post-run state with ALL THREE triage changes
  //    applied to the target issue (label + assignee + comment), nothing else;
  //  - the expected state REJECTS each of the three "partial" states that apply
  //    only two of the three changes, proving the spec encodes all three rather
  //    than a subset. Labels/assignees are order-independent sets and comments
  //    match by author+body, so array order is irrelevant.
  it("encodes all three triage changes together, rejecting any two-change partial", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    const task = suite.find((candidate) => candidate.id === "ms-triage-export-perf");
    expect(task).toBeDefined();
    if (task === undefined) return;

    expect(task.tier).toBe("multi-step");

    const spec = task.scoringSpec(USER);
    expect(spec.kind).toBe("mutation");
    if (spec.kind !== "mutation") return;

    // Build a post-run state applying a chosen subset of the three triage changes
    // to the target issue, independently from groundTruth + the seed.
    const stateWith = (opts: { label: boolean; assignee: boolean; comment: boolean }) => {
      const baseline = groundTruth(USER);
      return {
        ...baseline,
        issues: baseline.issues.map((issue) => {
          if (issue.title !== MS_TARGET_ISSUE_TITLE) return issue;
          return {
            ...issue,
            labels: opts.label ? [...issue.labels, MS_ADDED_LABEL] : [...issue.labels],
            assignees: opts.assignee ? [...issue.assignees, USER] : [...issue.assignees],
            comments: opts.comment
              ? [...issue.comments, { author: USER, body: MS_ADDED_COMMENT_BODY }]
              : [...issue.comments],
          };
        }),
      };
    };

    // All three changes present, nothing else altered → the spec accepts it.
    const fullState = stateWith({ label: true, assignee: true, comment: true });
    expect(checkMutation(spec.expected, fullState).pass).toBe(true);

    // Each two-of-three partial is missing exactly one change → the spec rejects
    // it, proving all three are required (not a subset).
    const missingLabel = stateWith({ label: false, assignee: true, comment: true });
    const missingAssignee = stateWith({ label: true, assignee: false, comment: true });
    const missingComment = stateWith({ label: true, assignee: true, comment: false });
    expect(checkMutation(spec.expected, missingLabel).pass).toBe(false);
    expect(checkMutation(spec.expected, missingAssignee).pass).toBe(false);
    expect(checkMutation(spec.expected, missingComment).pass).toBe(false);
  });
});

// The two review tasks and the reviews they encode when self-review is permitted,
// from the task's stated purpose as the source of truth: the CSV pull request is
// APPROVED, the docs pull request gets a REQUEST-CHANGES review. Both target pull
// requests have no seeded reviews (bench/seed-plan.ts). ReviewKind and the Review
// shape come from bench/scoring-spec.ts.
const REVIEW_CSV_PULL_TITLE = "Implement CSV export";
const REVIEW_DOCS_PULL_TITLE = "Refresh documentation";
const REVIEW_CSV_BODY = "The CSV export path looks correct to me.";
const REVIEW_DOCS_BODY = "Please expand the installation section before this merges.";

describe("buildScoredSuite review tasks with self-review permitted", () => {
  // Behavior: when the host permits self-review, the two review tasks' expected
  // states encode a promoted review — an approval on the CSV pull request and a
  // request-changes on the docs pull request — rather than a plain comment review
  // (benchmark-harness spec, single-user-seed self-review promotion). We assert
  // through the real public checker (checkMutation) against baselines built
  // independently from groundTruth + the stated review kinds/bodies:
  //  - each expected state accepts a post-run state carrying the promoted review;
  //  - each expected state REJECTS the same review demoted to kind "comment",
  //    proving the promotion actually took effect (not just any review).
  it("encodes an approval on the CSV pull and a request-changes on the docs pull, rejecting comment-kind variants", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: true });

    const csvTask = suite.find((candidate) => candidate.id === "fta-review-csv-pull");
    expect(csvTask).toBeDefined();
    if (csvTask === undefined) return;
    const csvSpec = csvTask.scoringSpec(USER);
    expect(csvSpec.kind).toBe("mutation");
    if (csvSpec.kind !== "mutation") return;

    // CSV pull request: promoted to an approval.
    const csvApproved = stateWithReview(REVIEW_CSV_PULL_TITLE, {
      kind: "approved",
      body: REVIEW_CSV_BODY,
    });
    const csvComment = stateWithReview(REVIEW_CSV_PULL_TITLE, {
      kind: "comment",
      body: REVIEW_CSV_BODY,
    });
    expect(checkMutation(csvSpec.expected, csvApproved).pass).toBe(true);
    expect(checkMutation(csvSpec.expected, csvComment).pass).toBe(false);

    const docsTask = suite.find((candidate) => candidate.id === "fta-review-docs-pull");
    expect(docsTask).toBeDefined();
    if (docsTask === undefined) return;
    const docsSpec = docsTask.scoringSpec(USER);
    expect(docsSpec.kind).toBe("mutation");
    if (docsSpec.kind !== "mutation") return;

    // Docs pull request: promoted to a request-changes.
    const docsRequestChanges = stateWithReview(REVIEW_DOCS_PULL_TITLE, {
      kind: "request-changes",
      body: REVIEW_DOCS_BODY,
    });
    const docsComment = stateWithReview(REVIEW_DOCS_PULL_TITLE, {
      kind: "comment",
      body: REVIEW_DOCS_BODY,
    });
    expect(checkMutation(docsSpec.expected, docsRequestChanges).pass).toBe(true);
    expect(checkMutation(docsSpec.expected, docsComment).pass).toBe(false);
  });
});

describe("buildScoredSuite/buildBonusTasks review tasks with self-review NOT permitted", () => {
  // Behavior: when the host forbids self-review, the two review tasks fall back to
  // comment-type reviews in the scored suite, and the approve / request-changes
  // operations move to the bonus table under direction "self-review-unavailable"
  // (benchmark-harness spec, single-user-seed self-review fallback). We assert
  // through the real public checker (checkMutation) against baselines built
  // independently from groundTruth + the stated bodies, plus the bonus table's
  // public shape. Scored specs must encode COMMENT reviews (rejecting the promoted
  // kinds), and the bonus table gains the two unavailable operations only when
  // self-review is off.
  it("falls back to comment reviews in the scored suite and moves approve/request-changes to the bonus table", () => {
    const suite = buildScoredSuite({ selfReviewPermitted: false });

    // CSV pull request: a plain comment review, NOT an approval.
    const csvTask = suite.find((candidate) => candidate.id === "fta-review-csv-pull");
    expect(csvTask).toBeDefined();
    if (csvTask === undefined) return;
    const csvSpec = csvTask.scoringSpec(USER);
    expect(csvSpec.kind).toBe("mutation");
    if (csvSpec.kind !== "mutation") return;
    const csvComment = stateWithReview(REVIEW_CSV_PULL_TITLE, {
      kind: "comment",
      body: REVIEW_CSV_BODY,
    });
    const csvApproved = stateWithReview(REVIEW_CSV_PULL_TITLE, {
      kind: "approved",
      body: REVIEW_CSV_BODY,
    });
    expect(checkMutation(csvSpec.expected, csvComment).pass).toBe(true);
    expect(checkMutation(csvSpec.expected, csvApproved).pass).toBe(false);

    // Docs pull request: a plain comment review, NOT a request-changes.
    const docsTask = suite.find((candidate) => candidate.id === "fta-review-docs-pull");
    expect(docsTask).toBeDefined();
    if (docsTask === undefined) return;
    const docsSpec = docsTask.scoringSpec(USER);
    expect(docsSpec.kind).toBe("mutation");
    if (docsSpec.kind !== "mutation") return;
    const docsComment = stateWithReview(REVIEW_DOCS_PULL_TITLE, {
      kind: "comment",
      body: REVIEW_DOCS_BODY,
    });
    const docsRequestChanges = stateWithReview(REVIEW_DOCS_PULL_TITLE, {
      kind: "request-changes",
      body: REVIEW_DOCS_BODY,
    });
    expect(checkMutation(docsSpec.expected, docsComment).pass).toBe(true);
    expect(checkMutation(docsSpec.expected, docsRequestChanges).pass).toBe(false);

    // The approve and request-changes operations appear in the bonus table under
    // "self-review-unavailable" when self-review is off.
    const bonusOff = buildBonusTasks({ selfReviewPermitted: false });
    const unavailable = bonusOff.filter(
      (entry) => entry.direction === "self-review-unavailable",
    );
    expect(
      unavailable.some((entry) => /approv/i.test(entry.operation)),
    ).toBe(true);
    expect(
      unavailable.some((entry) => /request.*chang/i.test(entry.operation)),
    ).toBe(true);

    // When self-review works, those operations are scored, not bonus.
    const bonusOn = buildBonusTasks({ selfReviewPermitted: true });
    expect(
      bonusOn.some((entry) => entry.direction === "self-review-unavailable"),
    ).toBe(false);
  });
});

// The asymmetric operations, as independent literals from the benchmark-harness
// spec (never task-suite.ts): gitea-axi outreaches the other arms on full-text
// search, diff, checks, checkout, and issue dependencies; and reports
// not-applicable for the operations outside its scope — repository, release, and
// milestone management.
const GITEA_AXI_EDGE_OPERATIONS = ["search", "diff", "checks", "checkout", "depend"];
const OUT_OF_SCOPE_OPERATIONS = ["repository", "release", "milestone"];

describe("buildBonusTasks capability-asymmetry definitions", () => {
  // Behavior: the bonus definitions cover the capability asymmetries in BOTH
  // directions — operations where gitea-axi outreaches the other arms
  // (gitea-axi-advantage / applicable) and operations outside gitea-axi's scope
  // (gitea-axi-not-applicable / not-applicable) — and are kept separate from the
  // scored suite (benchmark-harness spec, "bonus table"). Assessed on the static
  // both-directions definitions (self-review permitted, so the self-review pair is
  // absent). The named operations are independent literals from the spec.
  it("covers gitea-axi's five edges and the three out-of-scope operations, disjoint from the scored suite", () => {
    const bonus = buildBonusTasks({ selfReviewPermitted: true });

    // Advantage direction: every advantage entry is applicable, and together the
    // advantage operations cover each of gitea-axi's five named edges.
    const advantage = bonus.filter((entry) => entry.direction === "gitea-axi-advantage");
    for (const entry of advantage) {
      expect(entry.giteaAxi).toBe("applicable");
    }
    const advantageText = advantage.map((entry) => entry.operation.toLowerCase());
    for (const edge of GITEA_AXI_EDGE_OPERATIONS) {
      expect(advantageText.some((op) => op.includes(edge))).toBe(true);
    }

    // Not-applicable direction: entries marked not-applicable cover repository,
    // release, and milestone management.
    const notApplicable = bonus.filter(
      (entry) => entry.direction === "gitea-axi-not-applicable",
    );
    for (const entry of notApplicable) {
      expect(entry.giteaAxi).toBe("not-applicable");
    }
    const notApplicableText = notApplicable.map((entry) => entry.operation.toLowerCase());
    for (const scope of OUT_OF_SCOPE_OPERATIONS) {
      expect(notApplicableText.some((op) => op.includes(scope))).toBe(true);
    }

    // Kept separate: no bonus-task id (under either option value) collides with a
    // scored-suite task id (under either option value).
    const bonusIds = new Set(
      [
        ...buildBonusTasks({ selfReviewPermitted: true }),
        ...buildBonusTasks({ selfReviewPermitted: false }),
      ].map((entry) => entry.id),
    );
    const scoredIds = new Set(
      [
        ...buildScoredSuite({ selfReviewPermitted: true }),
        ...buildScoredSuite({ selfReviewPermitted: false }),
      ].map((task) => task.id),
    );
    const overlap = [...bonusIds].filter((id) => scoredIds.has(id));
    expect(overlap).toEqual([]);
  });
});
