import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const PULL_PATH = "/api/v1/repos/testowner/testrepo/pulls/5";
const STATUS_PATH = "/api/v1/repos/testowner/testrepo/commits/abc123/status";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("pr checks", () => {
  it("renders a summary line and a checks list mapping each commit-status state", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: { number: 5, head: { sha: "abc123", ref: "feature" } },
      },
      {
        method: "GET",
        path: STATUS_PATH,
        body: {
          sha: "abc123",
          total_count: 2,
          statuses: [
            { context: "build", status: "success" },
            { context: "test", status: "failure" },
          ],
        },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "checks", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("summary: 1 passed, 1 failed, 2 total");
    expect(stdout).toContain("checks[2]{name,conclusion}:");
    expect(stdout).toContain("  build,pass");
    expect(stdout).toContain("  test,fail");
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("renders a scalar checks line, not a list block, when no statuses are configured", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: { number: 5, head: { sha: "abc123", ref: "feature" } },
      },
      {
        method: "GET",
        path: STATUS_PATH,
        body: { sha: "abc123", total_count: 0, statuses: [] },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "checks", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "checks: 0 passed, 0 failed — this PR has no CI checks configured",
    );
    expect(stdout).not.toContain("summary:");
    expect(stdout).not.toMatch(/checks\[\d+\]\{/);
    expect(stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("maps every commit-status state and folds skipped/pending into the summary when non-zero", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: PULL_PATH,
        body: { number: 5, head: { sha: "abc123", ref: "feature" } },
      },
      {
        method: "GET",
        path: STATUS_PATH,
        body: {
          sha: "abc123",
          total_count: 5,
          statuses: [
            { context: "lint", status: "success" },
            { context: "build", status: "failure" },
            { context: "deploy", status: "warning" },
            { context: "e2e", status: "skipped" },
            { context: "docs", status: "pending" },
          ],
        },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "checks", "5"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("summary: 1 passed, 2 failed, 1 skipped, 1 pending, 5 total");
    expect(stdout).toContain("checks[5]{name,conclusion}:");
    expect(stdout).toContain("  lint,pass");
    expect(stdout).toContain("  build,fail");
    expect(stdout).toContain("  deploy,fail");
    expect(stdout).toContain("  e2e,skip");
    expect(stdout).toContain("  docs,pending");
  });

  it("reports a nonexistent PR as PR_NOT_FOUND with exit 1", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/999",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["pr", "checks", "999"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: PR_NOT_FOUND");
  });
});
