import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { runCliTest } from "../harness.js";
import {
  COVERED_ISSUE_PATHS,
  fetchRawIssues,
  hasPath,
  provisionInstance,
  type E2EInstance,
} from "./provision.js";

/**
 * The end-to-end tier: the real CLI seam (argv in, stdout/exit-code out) against
 * a live, disposable Gitea instance seeded over its own API. Gated on
 * GITEA_AXI_E2E_URL so the default `npm test` (unit + integration tiers) never
 * needs a live instance; CI sets it to the service container's URL.
 */
const E2E_URL = process.env.GITEA_AXI_E2E_URL;

const RELATIVE_TIME = /(just now|\d+(m|h|d|mo|y) ago)/;

describe.skipIf(!E2E_URL)("end-to-end: tracer command set", () => {
  let instance: E2EInstance;

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
  }, 150_000);

  it("lists seeded open issues with the default fields and a live count line", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list"], { env: env() });

    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("count: 3 open of 3 total");
    expect(lines[1]).toBe("issues[3]{number,title,state,author,created}:");
    for (const title of instance.openTitles) {
      expect(stdout).toContain(title);
    }
    expect(stdout).toContain(`,open,${instance.owner},`);
    expect(stdout).toMatch(RELATIVE_TIME);
    expect(stdout).toMatch(/^help\[\d+\]:/m);
    // No `type` field ever leaks into the row header.
    expect(lines[1]).not.toContain("type");
  });

  it("filters to the seeded closed issue with --state closed", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--state", "closed"], {
      env: env(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 1 closed of 1 total");
    expect(stdout).toContain(instance.closedTitle);
    expect(stdout).toContain(",closed,");
  });

  it("honors --limit and reports the full total from X-Total-Count", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--limit", "1"], {
      env: env(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 1 open of 3 total");
    expect(stdout).toContain("issues[1]{number,title,state,author,created}:");
    expect(stdout).toContain("issue list --limit <n>");
  });

  it("classifies a missing repository as REPO_NOT_FOUND with exit code 1", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: env({ GITEA_AXI_REPO: `${instance.owner}/does-not-exist-e2e` }),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: REPO_NOT_FOUND");
  });

  it("rejects an invalid --state before touching the network, exit code 2", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--state", "banana"], {
      env: env(),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
  });

  it("renders the home view against the live repo", async () => {
    const { stdout, exitCode } = await runCliTest([], { env: env() });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`repo: ${instance.owner}/${instance.repo}`);
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("guards against fixture-vs-live divergence in the issues response shape", async () => {
    // The recorded fixture that the integration tier asserts against. The
    // covered-paths contract must hold on both it and the live payload; if
    // either drifts from the shape the extractors read, this tier fails.
    const fixture = JSON.parse(
      readFileSync(new URL("../fixtures/issues-open.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>[];
    for (const recorded of fixture) {
      for (const path of COVERED_ISSUE_PATHS) {
        expect(hasPath(recorded, path), `fixture missing ${path}`).toBe(true);
      }
    }

    const { issues, totalCount } = await fetchRawIssues(instance, "open");
    // The count line is built from this header; its absence would silently
    // change output, so it is part of the covered shape.
    expect(totalCount).toBe("3");
    expect(issues).toHaveLength(3);
    for (const issue of issues) {
      for (const path of COVERED_ISSUE_PATHS) {
        expect(hasPath(issue, path), `live issue missing ${path}`).toBe(true);
      }
      expect((issue.user as Record<string, unknown>).login).toBe(instance.owner);
    }
  });
});
