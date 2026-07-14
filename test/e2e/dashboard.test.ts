import { beforeAll, describe, expect, it } from "vitest";
import { runCliTest } from "../harness.js";
import { provisionInstance, seedBranch, type E2EInstance } from "./provision.js";

/**
 * The end-to-end tier for the dashboard. The short and full tiers read the live
 * issue-list and PR-list responses, then compute two fields the fixture server
 * can only stub: the per-PR `review` (folded from a separate reviews fetch) and
 * the full-tier label aggregation (issue counts grouped by label). Those live
 * response shapes and derived fields are exactly what fixtures cannot attest to,
 * so here both tiers run against a live, disposable Gitea instance. Unlike the
 * search tier, the dashboard hits immediately-consistent list endpoints, so no
 * indexer polling is needed — assertions run directly after provisioning.
 */
const E2E_URL = process.env.GITEA_AXI_E2E_URL;

describe.skipIf(!E2E_URL)("end-to-end: dashboard", () => {
  let instance: E2EInstance;
  const branch = "e2e-dashboard-branch";

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
    // through the CLI dogfood path so the dashboard's PR block has a real row.
    await seedBranch(instance, branch);
    const created = await runCliTest(
      [
        "pr", "create",
        "--title", "E2E dashboard pull request",
        "--head", branch,
        "--base", "main",
      ],
      { env: env() },
    );
    expect(created.exitCode).toBe(0);
  }, 150_000);

  it("renders the bare dashboard with live issue and PR list shapes and a computed review", async () => {
    const { stdout, exitCode } = await runCliTest([], { env: env() });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`repo: ${instance.owner}/${instance.repo}`);

    // The issue block is the short-tier list shape, populated from the live
    // issue-list response — one of the seeded open titles must appear.
    expect(stdout).toMatch(/^issues\[\d+\]\{number,title,state,author\}:$/m);
    expect(stdout).toContain(instance.openTitles[0]!);

    // The PR block carries the client-side `review` field. The seeded PR has no
    // reviews yet, so it computes `required`; the union guards against the value
    // legitimately being an approval/change-request in some run.
    expect(stdout).toMatch(/^prs\[\d+\]\{number,title,author,review\}:$/m);
    expect(stdout).toMatch(/,(approved|changes_requested|required)$/m);
  });

  it("renders the --full PR table and label-aggregation against live responses", async () => {
    const { stdout, exitCode } = await runCliTest(["--full"], { env: env() });

    expect(exitCode).toBe(0);

    // The full tier renders the open-PR table with a labels column and a count
    // line, both derived from the live list response.
    expect(stdout).toMatch(/^prs\[\d+\]\{number,title,author,labels,review\}:$/m);
    expect(stdout).toMatch(/^count: \d+ of \d+ total$/m);

    // The full-tier issues block is a label->count record. The seeded open
    // issues are unlabeled, so an `unlabeled` bucket must be present.
    expect(stdout).toMatch(/^ {2}unlabeled: \d+$/m);
  });
});
