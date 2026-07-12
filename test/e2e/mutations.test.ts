import { beforeAll, describe, expect, it } from "vitest";
import { runCliTest } from "../harness.js";
import {
  fetchComments,
  fetchIssue,
  provisionInstance,
  type E2EInstance,
} from "./provision.js";

/**
 * The end-to-end tier for the issue mutations. These commands lean on behavior
 * the fixture server cannot attest to — above all that Gitea's label and
 * milestone name lookups really are case-insensitive, and that `CreateIssueOption`
 * really takes label *ids* rather than names. Both are asserted here against a
 * live instance by passing names in a different case than they were seeded in.
 */
const E2E_URL = process.env.GITEA_AXI_E2E_URL;

/** Read the `number:` scalar out of a rendered detail block. */
function renderedNumber(stdout: string): number {
  const match = stdout.match(/^\s*number:\s*(\d+)$/m);
  expect(match, `no number field in output:\n${stdout}`).not.toBeNull();
  return Number(match![1]);
}

describe.skipIf(!E2E_URL)("end-to-end: issue mutations", () => {
  let instance: E2EInstance;

  function env(): Record<string, string> {
    return {
      GITEA_AXI_API_URL: instance.baseUrl,
      GITEA_AXI_TOKEN: instance.token,
      GITEA_AXI_REPO: `${instance.owner}/${instance.repo}`,
    };
  }

  beforeAll(async () => {
    instance = await provisionInstance(E2E_URL!);
  }, 150_000);

  it("creates an issue and reports the live number, state, and url", async () => {
    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "E2E created issue", "--body", "Created by the e2e tier."],
      { env: env() },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("issue:");
    expect(stdout).toContain("title: E2E created issue");
    expect(stdout).toContain("state: open");
    expect(stdout).toContain(`${instance.owner}/${instance.repo}/issues/`);

    const created = await fetchIssue(instance, renderedNumber(stdout));
    expect(created.title).toBe("E2E created issue");
    expect(created.body).toBe("Created by the e2e tier.");
  });

  it("resolves a differently-cased --label and --milestone against live Gitea", async () => {
    // The seeds are "E2E-Bug" and "E2E-Milestone"; both are passed here in a
    // case that does not match, which is the whole point of the assertion.
    const { stdout, exitCode } = await runCliTest(
      [
        "issue",
        "create",
        "--title",
        "E2E labelled issue",
        "--label",
        instance.labelName.toLowerCase(),
        "--milestone",
        instance.milestoneTitle.toUpperCase(),
      ],
      { env: env() },
    );

    expect(exitCode).toBe(0);

    const created = await fetchIssue(instance, renderedNumber(stdout));
    const labels = (created.labels ?? []) as { name?: string }[];
    expect(labels.map((label) => label.name)).toEqual([instance.labelName]);
    const milestone = created.milestone as { title?: string } | null;
    expect(milestone?.title).toBe(instance.milestoneTitle);
  });

  it("rejects an unknown label name without creating the issue", async () => {
    const before = await runCliTest(["issue", "list", "--limit", "1"], { env: env() });
    const totalBefore = before.stdout.match(/of (\d+) total/)![1];

    const { stdout, exitCode } = await runCliTest(
      ["issue", "create", "--title", "E2E never created", "--label", "no-such-label"],
      { env: env() },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");

    const after = await runCliTest(["issue", "list", "--limit", "1"], { env: env() });
    expect(after.stdout).toContain(`of ${totalBefore} total`);
  });

  it("posts a comment on a live issue and echoes it back", async () => {
    const created = await runCliTest(["issue", "create", "--title", "E2E comment target"], {
      env: env(),
    });
    const number = renderedNumber(created.stdout);

    const { stdout, exitCode } = await runCliTest(
      ["issue", "comment", String(number), "--body", "A comment from the e2e tier."],
      { env: env() },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comment:");
    expect(stdout).toContain(`number: ${number}`);
    expect(stdout).toContain(`author: ${instance.owner}`);
    expect(stdout).toContain("body: A comment from the e2e tier.");

    const comments = await fetchComments(instance, number);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe("A comment from the e2e tier.");
  });
});
