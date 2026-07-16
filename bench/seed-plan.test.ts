import { describe, expect, it } from "vitest";
import { SEED_PLAN, groundTruth } from "./seed-plan.js";

describe("SEED_PLAN discriminating dimensions", () => {
  it("spreads its issues across both states and both assignee-presence values", () => {
    // The single-user-seed ADR and the benchmark-harness spec name state and
    // assignee presence (assigned-to-self versus unassigned) as discriminating
    // dimensions. So the seeded issues must exercise both poles of each axis:
    // at least one open AND one closed, at least one assigned-to-self AND one
    // unassigned. These are independent spec-derived invariants, not values
    // recomputed from the seed.
    const states = new Set(SEED_PLAN.issues.map((issue) => issue.state));
    const assigneePresence = new Set(
      SEED_PLAN.issues.map((issue) => issue.assignToSelf),
    );

    expect(states).toContain("open");
    expect(states).toContain("closed");
    expect(assigneePresence).toContain(true);
    expect(assigneePresence).toContain(false);
  });

  it("repeats a title keyword across several issues so a keyword filter selects a subset", () => {
    // Title keyword is one of the four discriminating dimensions, and the spec
    // weights the suite toward find-then-act tasks where a filter must select
    // more than one issue. So a bug-cluster keyword like "crash" must recur:
    // at least two distinct issues carry it (case-insensitively). "crash" is an
    // independent domain literal, not a value read back from the seed.
    const keyword = "crash";
    const matching = SEED_PLAN.issues.filter((issue) =>
      issue.title.toLowerCase().includes(keyword),
    );

    expect(matching.length).toBeGreaterThanOrEqual(2);
  });

  it("defines a closed set of fixed-colour labels that every applied issue label belongs to", () => {
    // The spec says the seed establishes a fixed set of labels with fixed
    // colours and that issues vary by label; the ADR keeps the seed small and
    // deterministic. So there must be at least three distinct labels, each with
    // a fixed six-digit hex colour, and no issue may apply a label the plan does
    // not define — the label set is closed. The hex pattern and the closed-set
    // relation are independent spec-derived invariants, not seed values.
    const hexColour = /^#[0-9a-fA-F]{6}$/;
    const definedNames = new Set(SEED_PLAN.labels.map((label) => label.name));

    expect(definedNames.size).toBeGreaterThanOrEqual(3);
    for (const label of SEED_PLAN.labels) {
      expect(label.color).toMatch(hexColour);
    }

    const appliedNames = new Set(
      SEED_PLAN.issues.flatMap((issue) => issue.labels),
    );
    for (const name of appliedNames) {
      expect(definedNames).toContain(name);
    }
  });

  it("varies label application and gives at least one issue pre-existing comments", () => {
    // The spec describes the seed as a spread of issues varying by label and
    // pre-existing comments. So label application must span both extremes: at
    // least one unlabelled issue and at least one carrying multiple labels; and
    // at least one issue must arrive with pre-existing comments. These are
    // independent spec-derived invariants, not values recomputed from the seed.
    const unlabelled = SEED_PLAN.issues.filter(
      (issue) => issue.labels.length === 0,
    );
    const multiLabelled = SEED_PLAN.issues.filter(
      (issue) => issue.labels.length >= 2,
    );
    const commented = SEED_PLAN.issues.filter(
      (issue) => issue.comments.length > 0,
    );

    expect(unlabelled.length).toBeGreaterThanOrEqual(1);
    expect(multiLabelled.length).toBeGreaterThanOrEqual(1);
    expect(commented.length).toBeGreaterThanOrEqual(1);
  });

  it("backs every pull request with a real feature branch and includes a labelled one and a reviewed one", () => {
    // The spec says the seed provides a handful of pull requests including one
    // labelled, one carrying an existing review, and one backed by a real pushed
    // feature branch — and every Gitea pull request needs a real head branch
    // with a diff to exist at all. So the set must be non-empty, every pull
    // request must carry a non-empty head branch and a file (path and content),
    // and at least one must be labelled and at least one must carry a review.
    // These are independent spec-derived invariants, not seed values.
    expect(SEED_PLAN.pullRequests.length).toBeGreaterThanOrEqual(1);

    for (const pr of SEED_PLAN.pullRequests) {
      expect(pr.headBranch.length).toBeGreaterThan(0);
      expect(pr.filePath.length).toBeGreaterThan(0);
      expect(pr.fileContent.length).toBeGreaterThan(0);
    }

    const labelled = SEED_PLAN.pullRequests.filter((pr) => pr.labels.length > 0);
    const reviewed = SEED_PLAN.pullRequests.filter(
      (pr) => pr.reviews.length > 0,
    );

    expect(labelled.length).toBeGreaterThanOrEqual(1);
    expect(reviewed.length).toBeGreaterThanOrEqual(1);
  });

  it("numbers issues then pull requests in one shared sequence starting at 1", () => {
    // A freshly provisioned Gitea repository draws issue and pull-request numbers
    // from ONE shared sequence in creation order, and the seed creates all issues
    // first, then all pull requests. So for N issues and M pull requests the
    // issues carry 1..N in plan order and the pull requests carry N+1..N+M in
    // plan order, with no overlap. The expected numbers are derived independently
    // from the plan lengths (the shared-sequence rule), not read from groundTruth.
    const n = SEED_PLAN.issues.length;
    const m = SEED_PLAN.pullRequests.length;
    const expectedIssueNumbers = Array.from({ length: n }, (_, i) => i + 1);
    const expectedPrNumbers = Array.from({ length: m }, (_, i) => n + i + 1);

    const state = groundTruth("maintainer");

    expect(state.issues.map((issue) => issue.number)).toEqual(
      expectedIssueNumbers,
    );
    expect(state.pullRequests.map((pr) => pr.number)).toEqual(expectedPrNumbers);

    const allNumbers = [
      ...state.issues.map((issue) => issue.number),
      ...state.pullRequests.map((pr) => pr.number),
    ];
    expect(new Set(allNumbers).size).toBe(allNumbers.length);
  });

  it("realizes the single-user seed: self-assignment reflects the plan and all authorship is the one user", () => {
    // The single-user-seed ADR says all seed content is authored by the one
    // account, and assignee presence is assigned-to-self versus unassigned. So
    // in the realized state each issue's assignees is [user] exactly when the
    // plan issue's assignToSelf is true and [] otherwise, and every comment and
    // review carries author === user. Expected assignees are derived from
    // SEED_PLAN.issues[i].assignToSelf (the ADR rule), not read from groundTruth.
    const user = "seed-user";
    const state = groundTruth(user);

    state.issues.forEach((issue, i) => {
      const expected = SEED_PLAN.issues[i]!.assignToSelf ? [user] : [];
      expect(issue.assignees).toEqual(expected);
    });

    const commentAuthors = [
      ...state.issues.flatMap((issue) => issue.comments),
      ...state.pullRequests.flatMap((pr) => pr.comments),
      ...state.pullRequests.flatMap((pr) =>
        pr.reviews.flatMap((review) => review.comments),
      ),
    ].map((comment) => comment.author);
    const reviewAuthors = state.pullRequests
      .flatMap((pr) => pr.reviews)
      .map((review) => review.author);

    for (const author of [...commentAuthors, ...reviewAuthors]) {
      expect(author).toBe(user);
    }
  });
});
