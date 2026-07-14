import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const DIFF_PATH = "/api/v1/repos/testowner/testrepo/pulls/7.diff";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("pr diff", () => {
  it("outputs the raw diff verbatim when under the limit, with no truncation fields", async () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "index 1234567..89abcde 100644",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1,3 +1,4 @@",
      " # Project",
      " ",
      "-Old tagline",
      "+New tagline",
      "+An extra line",
      "",
    ].join("\n");

    server = await startFixtureServer([
      { method: "GET", path: DIFF_PATH, raw: diff },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "diff", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("pr_diff:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("+New tagline");
    expect(stdout).not.toContain("truncated:");
    expect(stdout).not.toContain("original_length:");
  });

  it("truncates a diff over 4000 chars to the first 4000 and reports the original length", async () => {
    const diff = "x".repeat(4100);

    server = await startFixtureServer([
      { method: "GET", path: DIFF_PATH, raw: diff },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "diff", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("truncated: true");
    expect(stdout).toContain("original_length: 4100");
    expect(stdout).toContain("Run `gitea-axi pr diff 7");
    expect(stdout).toContain("--full");
    expect(stdout).toContain("to see the complete diff");
    expect(stdout).toContain("x".repeat(4000));
    expect(stdout).not.toContain("x".repeat(4001));
  });

  it("passes a diff of exactly 4000 chars through untouched", async () => {
    const diff = "y".repeat(4000);

    server = await startFixtureServer([
      { method: "GET", path: DIFF_PATH, raw: diff },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "diff", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("truncated:");
    expect(stdout).not.toContain("original_length:");
  });

  it("returns the complete diff and suppresses truncation with --full", async () => {
    const diff = "z".repeat(4100);

    server = await startFixtureServer([
      { method: "GET", path: DIFF_PATH, raw: diff },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "diff", "7", "--full"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("z".repeat(4100));
    expect(stdout).not.toContain("truncated:");
    expect(stdout).not.toContain("original_length:");
  });

  it("reports a nonexistent pull request as PR_NOT_FOUND with exit 1", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/999.diff",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "diff", "999"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: PR_NOT_FOUND");
  });
});
