import { beforeAll, describe, expect, it } from "vitest";
import { runCliTest } from "../harness.js";
import { provisionInstance, seedBranch, type E2EInstance } from "./provision.js";

/**
 * The end-to-end tier for the search commands. The `/repos/issues/search`
 * endpoint spans repositories and reports an unfiltered cross-repo total, so the
 * live response shape and the `type`/`owner`/`q` query behavior are precisely
 * what the fixture server can only simulate. Here both variants run against a
 * live, disposable Gitea instance and are asserted to return real matches under
 * the locator schema.
 */
const E2E_URL = process.env.GITEA_AXI_E2E_URL;

const RELATIVE_TIME = /(just now|\d+(m|h|d|mo|y) ago)/;

describe.skipIf(!E2E_URL)("end-to-end: search commands", () => {
  let instance: E2EInstance;
  const branch = "e2e-search-branch";

  function env(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      GITEA_AXI_API_URL: instance.baseUrl,
      GITEA_AXI_TOKEN: instance.token,
      GITEA_AXI_REPO: `${instance.owner}/${instance.repo}`,
      ...overrides,
    };
  }

  beforeAll(async () => {
    instance = await provisionInstance(E2E_URL!);
    // A fresh repo has no pull requests; seed a branch with a diff and open one
    // through the CLI dogfood path so `search prs` has a real match to find.
    await seedBranch(instance, branch);
    const created = await runCliTest(
      [
        "pr", "create",
        "--title", "E2E search pull request",
        "--head", branch,
        "--base", "main",
      ],
      { env: env() },
    );
    expect(created.exitCode).toBe(0);
  }, 150_000);

  it("returns live issue matches under the locator schema", async () => {
    // Gitea's search endpoint is backed by an eventually-consistent issue
    // indexer, so poll until the seeded issue has been indexed and surfaces
    // under the locator-schema header before asserting on the exact output.
    await expect
      .poll(
        async () => (await runCliTest(["search", "issues", "issue"], { env: env() })).stdout,
        { timeout: 20_000, interval: 500 },
      )
      .toMatch(/^issues\[\d+\]\{number,title,state,author,created\}:$/m);

    const { stdout, exitCode } = await runCliTest(["search", "issues", "issue"], {
      env: env(),
    });

    expect(exitCode).toBe(0);
    // The block header is the default locator schema: the live search response
    // is Issue-shaped and rendered by the same field set as `issue list`.
    expect(stdout).toMatch(/^issues\[\d+\]\{number,title,state,author,created\}:$/m);
    // Real matches from the current repo: a seeded open issue title, the author
    // column (the instance owner), and a rendered relative-time `created`.
    expect(stdout).toContain(instance.openTitles[0]!);
    expect(stdout).toContain(instance.owner);
    expect(stdout).toMatch(RELATIVE_TIME);
  });

  it("returns live pull-request matches under the locator schema", async () => {
    // The PR was opened moments ago in beforeAll; the indexer needs a beat to
    // catch up, so poll the search until the PR surfaces before asserting.
    await expect
      .poll(
        async () => (await runCliTest(["search", "prs", "search"], { env: env() })).stdout,
        { timeout: 20_000, interval: 500 },
      )
      .toMatch(/^pull_requests\[\d+\]\{number,title,state,author,created\}:$/m);

    const { stdout, exitCode } = await runCliTest(["search", "prs", "search"], {
      env: env(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^pull_requests\[\d+\]\{number,title,state,author,created\}:$/m);
    expect(stdout).toContain("E2E search pull request");
  });
});
