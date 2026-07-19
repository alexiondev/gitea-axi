import { describe, expect, it } from "vitest";
import { checkMutation, checkReadAnswer, score } from "./checker.js";
import type { Submission } from "./checker.js";
import type {
  Issue,
  Label,
  PullRequest,
  RepoState,
  RequiredFact,
  ScoringSpec,
} from "./scoring-spec.js";

/** Build an issue with sensible defaults, overridable per test. */
function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: "Login button misaligned",
    body: "The submit button overflows on mobile.",
    state: "open",
    labels: [],
    assignees: [],
    comments: [],
    ...overrides,
  };
}

/** Build a label with sensible defaults, overridable per test. */
function label(overrides: Partial<Label> = {}): Label {
  return {
    name: "bug",
    color: "#d73a4a",
    ...overrides,
  };
}

/** Build a pull request with sensible defaults, overridable per test. */
function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 5,
    title: "Fix login button alignment",
    body: "Closes #1.",
    state: "merged",
    labels: [],
    assignees: [],
    comments: [],
    reviews: [],
    ...overrides,
  };
}

/** Build a full repository snapshot with sensible defaults, overridable per test. */
function repo(overrides: Partial<RepoState> = {}): RepoState {
  return {
    labels: [],
    issues: [],
    pullRequests: [],
    ...overrides,
  };
}

describe("checkMutation", () => {
  it("passes when the actual state matches the expected end state after normalization", () => {
    // Intended change: issue #1 is closed and the "bug" label applied. The expected
    // end state fixes that outcome.
    const expected = repo({
      labels: [label({ name: "bug", color: "#d73a4a" })],
      issues: [issue({ number: 1, state: "closed", labels: ["bug"] })],
    });

    // The actual post-run snapshot embodies the same outcome, but carries volatile
    // host-assigned ids/timestamps and lists the label set in a different order —
    // all of which normalization must ignore.
    const actual = repo({
      labels: [label({ name: "bug", color: "#d73a4a" })],
      issues: [
        issue({
          number: 1,
          state: "closed",
          labels: ["bug"],
          id: 4201,
          createdAt: "2026-07-15T09:00:00Z",
          updatedAt: "2026-07-16T10:30:00Z",
        }),
      ],
    });

    expect(checkMutation(expected, actual)).toEqual({ pass: true });
  });

  it("fails and names the affected entity when the actual state is missing the intended change", () => {
    // Intended change: issue #1 is closed. The expected end state fixes that outcome.
    const expected = repo({
      issues: [issue({ number: 1, state: "closed" })],
    });

    // The change did not happen: issue #1 is still open in the actual post-run state.
    const actual = repo({
      issues: [issue({ number: 1, state: "open" })],
    });

    const result = checkMutation(expected, actual);

    expect(result.pass).toBe(false);
    // A diagnosable failure names the affected entity so a failed trial can be
    // traced back to what diverged — here, issue #1.
    if (result.pass === false) {
      expect(result.differences.some((d) => d.includes("#1"))).toBe(true);
    }
  });

  it("fails and names the stray label when the actual state carries collateral change", () => {
    // Intended change: issue #1 closed, carrying no applied labels. Both snapshots
    // define the same repository labels and agree on the closed state of #1.
    const expected = repo({
      labels: [
        label({ name: "bug", color: "#d73a4a" }),
        label({ name: "wontfix", color: "#ffffff" }),
      ],
      issues: [issue({ number: 1, state: "closed", labels: [] })],
    });

    // Collateral damage: an extra "wontfix" label was applied to issue #1 even
    // though the expected end state leaves it unlabelled.
    const actual = repo({
      labels: [
        label({ name: "bug", color: "#d73a4a" }),
        label({ name: "wontfix", color: "#ffffff" }),
      ],
      issues: [issue({ number: 1, state: "closed", labels: ["wontfix"] })],
    });

    const result = checkMutation(expected, actual);

    expect(result.pass).toBe(false);
    // The stray label must be named so the collateral change is diagnosable —
    // knowing #1's labels merely "differ" does not say what was wrongly applied.
    if (result.pass === false) {
      expect(result.differences.some((d) => d.includes("wontfix"))).toBe(true);
    }
  });

  it("passes when comments match by author and body despite differing order and volatile ids", () => {
    // The expected issue carries two comments in one order, with one set of
    // host-assigned ids and timestamps.
    const expected = repo({
      issues: [
        issue({
          number: 1,
          state: "closed",
          comments: [
            { author: "octocat", body: "Reproduced on mobile Safari.", id: 11, createdAt: "2026-07-15T09:00:00Z" },
            { author: "maintainer", body: "Fixed in the latest build.", id: 12, createdAt: "2026-07-15T10:00:00Z" },
          ],
        }),
      ],
    });

    // The actual issue carries the same set of comments by (author, body), but in
    // the reverse order and with entirely different volatile ids and timestamps —
    // all of which normalization must ignore.
    const actual = repo({
      issues: [
        issue({
          number: 1,
          state: "closed",
          comments: [
            { author: "maintainer", body: "Fixed in the latest build.", id: 907, createdAt: "2026-07-16T14:22:00Z" },
            { author: "octocat", body: "Reproduced on mobile Safari.", id: 906, createdAt: "2026-07-16T14:20:00Z" },
          ],
        }),
      ],
    });

    expect(checkMutation(expected, actual)).toEqual({ pass: true });
  });

  it("fails and names the missing comment when the actual state lacks a required comment", () => {
    // Intended change: issue #1 must carry a specific maintainer comment asking
    // for a reproduction case.
    const expected = repo({
      issues: [
        issue({
          number: 1,
          comments: [{ author: "maintainer", body: "Please add a reproduction case." }],
        }),
      ],
    });

    // The agent never posted that comment: the actual issue has no comments.
    const actual = repo({
      issues: [issue({ number: 1, comments: [] })],
    });

    const result = checkMutation(expected, actual);

    expect(result.pass).toBe(false);
    // The specific missing comment must be identifiable from its own text so the
    // divergence is diagnosable, not just "comments differ".
    if (result.pass === false) {
      expect(result.differences.some((d) => d.includes("Please add a reproduction case."))).toBe(
        true,
      );
    }
  });

  it("passes when an issue's applied labels match as a set despite differing order", () => {
    // The expected end state applies two labels to issue #1 in one order.
    const expected = repo({
      labels: [
        label({ name: "bug", color: "#d73a4a" }),
        label({ name: "priority:high", color: "#b60205" }),
      ],
      issues: [issue({ number: 1, state: "closed", labels: ["bug", "priority:high"] })],
    });

    // The actual issue carries the same applied labels, but lists them in the
    // reverse order — which an order-independent set comparison must ignore.
    const actual = repo({
      labels: [
        label({ name: "bug", color: "#d73a4a" }),
        label({ name: "priority:high", color: "#b60205" }),
      ],
      issues: [issue({ number: 1, state: "closed", labels: ["priority:high", "bug"] })],
    });

    expect(checkMutation(expected, actual)).toEqual({ pass: true });
  });

  it("passes when a pull request's reviews match as a set despite differing order", () => {
    // The expected pull request #5 carries two reviews in one order.
    const expected = repo({
      pullRequests: [
        pr({
          number: 5,
          state: "merged",
          reviews: [
            { author: "alexion", kind: "comment", body: "first pass", comments: [] },
            { author: "alexion", kind: "approved", body: "looks good", comments: [] },
          ],
        }),
      ],
    });

    // The actual pull request carries the same two reviews (each identified by
    // author, kind, and body) but lists them in the reverse order — which an
    // order-independent set comparison must ignore, as it already does for
    // comments and labels.
    const actual = repo({
      pullRequests: [
        pr({
          number: 5,
          state: "merged",
          reviews: [
            { author: "alexion", kind: "approved", body: "looks good", comments: [] },
            { author: "alexion", kind: "comment", body: "first pass", comments: [] },
          ],
        }),
      ],
    });

    expect(checkMutation(expected, actual)).toEqual({ pass: true });
  });
});

describe("checkReadAnswer", () => {
  it("passes when every required fact is present in the final report", () => {
    // A read task requires the agent to report a count of open issues and a
    // specific issue number; each fact lists acceptable renderings.
    const facts: RequiredFact[] = [
      { description: "count of open issues", anyOf: ["3 open issues", "three open issues"] },
      { description: "the stale issue's number", anyOf: ["#42", "issue 42"] },
    ];

    // The report plainly contains a rendering of each fact.
    const report = "I found 3 open issues; the oldest untouched one is #42.";

    expect(checkReadAnswer(facts, report)).toEqual({ pass: true });
  });

  it("fails and names the missing fact when a required fact is absent from the report", () => {
    // A read task requires two facts, each named by a distinctive description.
    const facts: RequiredFact[] = [
      { description: "the count of open bug issues", anyOf: ["2 open bug issues", "two open bug issues"] },
      { description: "the newest issue number", anyOf: ["#57", "issue 57"] },
    ];

    // The report renders the first fact but omits any rendering of the second.
    const report = "There are 2 open bug issues in the repository.";

    const result = checkReadAnswer(facts, report);

    expect(result.pass).toBe(false);
    // The unmet fact must be identifiable by its own description so a failed read
    // task can be diagnosed — not just "a required fact is missing".
    if (result.pass === false) {
      expect(result.differences.some((d) => d.includes("the newest issue number"))).toBe(true);
    }
  });

  it("passes on an alternate anyOf rendering that differs in case and whitespace", () => {
    // The fact offers two acceptable renderings of the same count.
    const facts: RequiredFact[] = [
      { description: "count of open issues", anyOf: ["3 open issues", "three open issues"] },
    ];

    // The report contains only the SECOND rendering, in different case and with
    // irregular internal whitespace — which case- and whitespace-insensitive
    // matching must still accept.
    const report = "There are   THREE   Open Issues left.";

    expect(checkReadAnswer(facts, report)).toEqual({ pass: true });
  });

  it("passes when the report wraps a fact's phrasing in markdown emphasis", () => {
    // The fact's acceptable phrasing is the bare substring "5 open".
    const facts: RequiredFact[] = [
      { description: "open-issue count", anyOf: ["5 open"] },
    ];

    // The report is correct but renders the number in markdown bold. Emphasis
    // markers (`*`, `_`, backtick) are formatting, not substance, so "**5**" is
    // equivalent to "5" and the phrasing "5 open" is present.
    const report = "There are **5** open issues in the repository.";

    expect(checkReadAnswer(facts, report)).toEqual({ pass: true });
  });

  it("fails when a markdown-formatted report states the wrong value", () => {
    // The only acceptable phrasing counts five open issues.
    const facts: RequiredFact[] = [
      { description: "open-issue count", anyOf: ["5 open"] },
    ];

    // The report is markdown-formatted but substantively wrong: it counts three,
    // not five. Stripping emphasis must only remove formatting, so after stripping
    // ("there are 3 open issues") the phrasing "5 open" is still absent.
    const report = "There are **3** open issues in the repository.";

    const result = checkReadAnswer(facts, report);

    expect(result.pass).toBe(false);
  });

  it("passes via pattern when filler words break every contiguous anyOf phrase", () => {
    // A count fact is brittle when pinned to fixed phrases: a human padding the
    // answer with filler words ("issues are currently") splits any contiguous
    // rendering. The optional `pattern` — a case-insensitive regex source — spans
    // that filler as a bounded run of alphabetic words between the number and
    // "open", so the fact is satisfied even though no `anyOf` phrase appears verbatim.
    const facts: RequiredFact[] = [
      {
        description: "count of open issues",
        anyOf: ["5 open", "5 issues are open"],
        pattern: "\\b5(?: [a-z]+){0,4} open\\b",
      },
    ];

    // "issues are currently" is inserted between "5" and "open", so neither
    // contiguous anyOf phrase matches — but the pattern's alphabetic filler run does.
    const report = "5 issues are currently open (5 of 5 total).";

    expect(checkReadAnswer(facts, report)).toEqual({ pass: true });
  });

  it("fails when a digit interrupts the number-to-open run, so a wrong count cannot slip through", () => {
    // The same pattern-bearing fact as above. Here the report states a DIFFERENT
    // open count (3), merely mentioning the number 5 elsewhere. The pattern's
    // filler run is alphabetic only, so the digit "3" between the matched "5" and
    // "open" is not spanned, and no anyOf phrase matches either — the fact fails.
    const facts: RequiredFact[] = [
      {
        description: "count of open issues",
        anyOf: ["5 open", "5 issues are open"],
        pattern: "\\b5(?: [a-z]+){0,4} open\\b",
      },
    ];

    // "5 issues in total, and 3 open" — the 5 is a total, the open count is 3.
    const report = "There are 5 issues in total, and 3 open.";

    const result = checkReadAnswer(facts, report);

    expect(result.pass).toBe(false);
    // The unmet fact must remain identifiable by its own description.
    if (result.pass === false) {
      expect(result.differences.some((d) => d.includes("count of open issues"))).toBe(true);
    }
  });

  it("still matches on anyOf alone when a fact carries no pattern", () => {
    // A fact without `pattern` behaves exactly as before: only the contiguous
    // anyOf renderings are consulted, unaffected by the new pattern support.
    const facts: RequiredFact[] = [
      { description: "count of open issues", anyOf: ["7 open issues", "seven open issues"] },
    ];

    const report = "The board shows 7 open issues right now.";

    expect(checkReadAnswer(facts, report)).toEqual({ pass: true });
  });
});

describe("score", () => {
  it("dispatches on the spec kind: full-state diff for mutations, answer-match for reads", () => {
    // A mutation spec is scored by diffing the submitted repository state against
    // the expected end state; a matching submission passes.
    const expectedState = repo({
      issues: [issue({ number: 1, state: "closed", labels: ["bug"] })],
      labels: [label({ name: "bug", color: "#d73a4a" })],
    });
    const mutationSpec: ScoringSpec = { kind: "mutation", expected: expectedState };
    const matchingSubmission: Submission = { kind: "mutation", state: expectedState };

    expect(score(mutationSpec, matchingSubmission)).toEqual({ pass: true });

    // A read spec is scored by matching required facts in the submitted report.
    const readSpec: ScoringSpec = {
      kind: "read",
      facts: [{ description: "the answer", anyOf: ["42"] }],
    };

    const passingRead: Submission = { kind: "read", report: "the answer is 42" };
    expect(score(readSpec, passingRead)).toEqual({ pass: true });

    // And a read submission lacking the required fact fails.
    const failingRead: Submission = { kind: "read", report: "no idea, sorry" };
    expect(score(readSpec, failingRead).pass).toBe(false);
  });

  it("throws when the submission's kind does not match the spec's kind", () => {
    // A mutation spec paired with a read submission is a caller error, not a
    // scoreable outcome: score must reject it rather than silently score the
    // wrong thing.
    const mutationSpec: ScoringSpec = {
      kind: "mutation",
      expected: repo({ issues: [issue({ number: 1, state: "closed" })] }),
    };
    const readSubmission: Submission = { kind: "read", report: "" };

    expect(() => score(mutationSpec, readSubmission)).toThrow();
  });
});
