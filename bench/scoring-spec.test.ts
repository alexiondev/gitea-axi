import { describe, expect, it } from "vitest";
import { score } from "./checker.js";
import type { ScoringSpec } from "./scoring-spec.js";

describe("ScoringSpec contract", () => {
  it("expresses both a mutation's expected end state and a read's required answer facts", () => {
    // A mutation spec fixes a rich expected end state: a labelled, commented,
    // closed issue AND a merged pull request carrying a review. This proves the
    // contract can express the whole scored surface, not just a single field.
    const mutationSpec: ScoringSpec = {
      kind: "mutation",
      expected: {
        labels: [{ name: "bug", color: "#d73a4a", description: "Something is broken" }],
        issues: [
          {
            number: 1,
            title: "Login button misaligned",
            body: "Overflows on mobile.",
            state: "closed",
            labels: ["bug"],
            assignees: ["octocat"],
            comments: [{ author: "maintainer", body: "Fixed in the latest build." }],
          },
        ],
        pullRequests: [
          {
            number: 2,
            title: "Fix login button alignment",
            body: "Closes #1.",
            state: "merged",
            labels: ["bug"],
            assignees: ["octocat"],
            comments: [{ author: "octocat", body: "Ready for review." }],
            reviews: [
              {
                author: "maintainer",
                kind: "approved",
                body: "Looks good.",
                comments: [{ author: "maintainer", body: "Nice fix." }],
              },
            ],
          },
        ],
      },
    };

    expect(mutationSpec.kind).toBe("mutation");
    // Scoring the very state the spec fixes must pass — the contract round-trips
    // through the scorer.
    expect(score(mutationSpec, { kind: "mutation", state: mutationSpec.expected })).toEqual({
      pass: true,
    });

    // A read spec instead carries required answer facts. This proves the contract
    // can express the read-task family.
    const readSpec: ScoringSpec = {
      kind: "read",
      facts: [
        { description: "count of open issues", anyOf: ["3 open issues", "three open issues"] },
        { description: "the stale issue's number", anyOf: ["#42", "issue 42"] },
      ],
    };

    expect(readSpec.kind).toBe("read");
    // A report rendering both facts must pass.
    const report = "There are 3 open issues; the oldest untouched one is #42.";
    expect(score(readSpec, { kind: "read", report })).toEqual({ pass: true });
  });
});
