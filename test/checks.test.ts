import { describe, expect, it } from "vitest";
import type { CommitStatus } from "gitea-js";
import { summarizeChecks } from "../src/checks.js";

describe("summarizeChecks", () => {
  it("maps success commit statuses to pass checks and omits zero skipped/pending segments", () => {
    const statuses = [
      { context: "build", status: "success" },
      { context: "test", status: "success" },
    ] as CommitStatus[];

    const result = summarizeChecks(statuses);

    expect(result.checks).toEqual([
      { name: "build", conclusion: "pass" },
      { name: "test", conclusion: "pass" },
    ]);
    expect(result.summary).toBe("2 passed, 0 failed, 2 total");
  });

  it("maps failure, error, and warning states all to fail (warning counts as failure)", () => {
    const statuses = [
      { context: "a", status: "failure" },
      { context: "b", status: "error" },
      { context: "c", status: "warning" },
    ] as CommitStatus[];

    const result = summarizeChecks(statuses);

    expect(result.checks).toEqual([
      { name: "a", conclusion: "fail" },
      { name: "b", conclusion: "fail" },
      { name: "c", conclusion: "fail" },
    ]);
    expect(result.summary).toBe("0 passed, 3 failed, 3 total");
  });
});
