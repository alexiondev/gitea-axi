import { beforeAll, describe, expect, it } from "vitest";
import { runCliTest } from "../harness.js";
import {
  fetchComments,
  fetchIssue,
  fetchLabels,
  fetchOpenPulls,
  provisionInstance,
  seedBranch,
  type E2EInstance,
} from "./provision.js";

/**
 * The end-to-end tier for the issue and pull request mutations. These commands
 * lean on behavior the fixture server cannot attest to — that Gitea's label and
 * milestone name lookups really are case-insensitive, that `CreateIssueOption`
 * really takes label *ids* rather than names, and that the by-base-head pull
 * lookup behind `pr create`'s idempotency check really answers a 404 when no
 * pull request exists for the pair and the open one when it does. Each is
 * asserted here against a live instance rather than a recorded shape.
 */
const E2E_URL = process.env.GITEA_AXI_E2E_URL;

/** Read the `number:` scalar out of a rendered detail block. */
function renderedNumber(stdout: string): number {
  const match = stdout.match(/^\s*number:\s*(\d+)$/m);
  expect(match, `no number field in output:\n${stdout}`).not.toBeNull();
  return Number(match![1]);
}

/**
 * One provisioned instance for every suite in this file: the suites run
 * sequentially within the file, and sharing the instance keeps the bootstrap
 * (which registers the site administrator) to a single run.
 */
let provisioned: Promise<E2EInstance> | undefined;
function instanceOnce(): Promise<E2EInstance> {
  provisioned ??= provisionInstance(E2E_URL!);
  return provisioned;
}

function envFor(instance: E2EInstance): Record<string, string> {
  return {
    GITEA_AXI_API_URL: instance.baseUrl,
    GITEA_AXI_TOKEN: instance.token,
    GITEA_AXI_REPO: `${instance.owner}/${instance.repo}`,
  };
}

describe.skipIf(!E2E_URL)("end-to-end: issue mutations", () => {
  let instance: E2EInstance;

  function env(): Record<string, string> {
    return envFor(instance);
  }

  beforeAll(async () => {
    instance = await instanceOnce();
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

describe.skipIf(!E2E_URL)("end-to-end: pull request mutations", () => {
  let instance: E2EInstance;
  const branch = "e2e-pr-branch";

  function env(): Record<string, string> {
    return envFor(instance);
  }

  beforeAll(async () => {
    instance = await instanceOnce();
    // The head branch has to exist, with a diff to propose, before a pull
    // request can be opened from it.
    await seedBranch(instance, branch);
  }, 150_000);

  it("creates a pull request, defaulting the base to the live repo's default branch", async () => {
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "E2E created PR", "--head", branch, "--body", "From the e2e tier."],
      { env: env() },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("created:");
    expect(stdout).toContain(`${instance.owner}/${instance.repo}/pulls/`);

    const pulls = await fetchOpenPulls(instance);
    expect(pulls).toHaveLength(1);
    const created = pulls[0]!;
    expect(created.number).toBe(renderedNumber(stdout));
    expect(created.title).toBe("E2E created PR");
    // The base was never passed: it came from the repository's own default branch.
    expect((created.base as { ref?: string }).ref).toBe("main");
    expect((created.head as { ref?: string }).ref).toBe(branch);
  });

  it("short-circuits a second create for the same branch pair, creating no duplicate", async () => {
    // Whether Gitea's by-base-head lookup really finds the pull request opened
    // above is the assumption the whole idempotency check rests on; fixtures can
    // only assert the shape of an answer they were told to give.
    const { stdout, exitCode } = await runCliTest(
      ["pr", "create", "--title", "E2E duplicate PR", "--head", branch],
      { env: env() },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull_request:");
    expect(stdout).toContain("already: true");
    expect(stdout).not.toContain("created:");

    const pulls = await fetchOpenPulls(instance);
    expect(pulls).toHaveLength(1);
    // The existing pull request is reported untouched — not retitled, not replaced.
    expect(pulls[0]!.title).toBe("E2E created PR");
  });

  it("posts a comment on a live pull request and echoes it back", async () => {
    const pulls = await fetchOpenPulls(instance);
    const number = pulls[0]!.number as number;

    const { stdout, exitCode } = await runCliTest(
      ["pr", "comment", String(number), "--body", "A PR comment from the e2e tier."],
      { env: env() },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("comment:");
    expect(stdout).toContain(`number: ${number}`);
    expect(stdout).toContain(`author: ${instance.owner}`);
    expect(stdout).toContain("body: A PR comment from the e2e tier.");

    // Pull requests really do share the issue comment endpoint, so the comment
    // is readable back through it.
    const comments = await fetchComments(instance, number);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe("A PR comment from the e2e tier.");
  });
});

describe.skipIf(!E2E_URL)("end-to-end: label mutations", () => {
  let instance: E2EInstance;
  // Unique to this block so it never collides with the seeded instance.labelName.
  const NAME = "E2E-Lifecycle";

  function env(): Record<string, string> {
    return envFor(instance);
  }

  beforeAll(async () => {
    instance = await instanceOnce();
  }, 150_000);

  /** The repo's labels named `name`, matched case-insensitively. */
  async function labelsNamed(name: string): Promise<Record<string, unknown>[]> {
    const labels = await fetchLabels(instance);
    return labels.filter(
      (label) => String(label.name).toLowerCase() === name.toLowerCase(),
    );
  }

  /** A color as Gitea returned it, with any leading `#` stripped for comparison. */
  function normalizedColor(label: Record<string, unknown>): string {
    return String(label.color).replace(/^#/, "");
  }

  it("creates, re-creates idempotently, edits, and deletes a label against live Gitea", async () => {
    // 1. Create: the CLI prepends `#` to the color, which live Gitea requires.
    const created = await runCliTest(
      ["label", "create", "--name", NAME, "--color", "ff0000"],
      { env: env() },
    );
    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain("created: ok");
    expect(created.stdout).toContain(`label: ${NAME}`);

    const afterCreate = await labelsNamed(NAME);
    expect(afterCreate).toHaveLength(1);
    expect(normalizedColor(afterCreate[0]!)).toBe("ff0000");

    // 2. Re-create with different casing: the live listing is checked
    //    case-insensitively, so no second label is made and nothing changes.
    const recreated = await runCliTest(
      ["label", "create", "--name", NAME.toUpperCase(), "--color", "00ff00"],
      { env: env() },
    );
    expect(recreated.exitCode).toBe(0);
    expect(recreated.stdout).toContain("create: already_exists");
    expect(recreated.stdout).toContain(`label: ${NAME}`);

    const afterRecreate = await labelsNamed(NAME);
    expect(afterRecreate).toHaveLength(1);
    expect(normalizedColor(afterRecreate[0]!)).toBe("ff0000");

    // 3. Edit: name→id resolution plus PATCH-by-id, verified live.
    const edited = await runCliTest(
      ["label", "edit", NAME, "--color", "00ff00"],
      { env: env() },
    );
    expect(edited.exitCode).toBe(0);
    expect(edited.stdout).toContain("edit: ok");

    const afterEdit = await labelsNamed(NAME);
    expect(afterEdit).toHaveLength(1);
    expect(normalizedColor(afterEdit[0]!)).toBe("00ff00");

    // 4. Delete: name→id resolution plus DELETE-by-id, verified live.
    const deleted = await runCliTest(["label", "delete", NAME], { env: env() });
    expect(deleted.exitCode).toBe(0);
    expect(deleted.stdout).toContain("delete: ok");

    expect(await labelsNamed(NAME)).toHaveLength(0);
  });

  it("refuses to delete a label that does not exist", async () => {
    const { stdout, exitCode } = await runCliTest(
      ["label", "delete", "no-such-label-xyz"],
      { env: env() },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
  });
});
