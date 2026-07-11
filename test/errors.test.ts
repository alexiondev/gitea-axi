import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

async function listWithStatus(status: number, body: unknown = { message: "boom" }) {
  server = await startFixtureServer([
    { method: "GET", path: ISSUES_PATH, status, body },
  ]);
  return runCliTest(["issue", "list"], { env: testModeEnv(server.url) });
}

describe("error classification", () => {
  it("maps 401 to AUTH_REQUIRED with exit code 1", async () => {
    const { stdout, exitCode } = await listWithStatus(401, { message: "token is required" });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: AUTH_REQUIRED");
    expect(stdout).toContain("error: token is required");
  });

  it("maps 403 to FORBIDDEN with exit code 1", async () => {
    const { stdout, exitCode } = await listWithStatus(403);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
  });

  it("maps a 404 on the repo subtree to REPO_NOT_FOUND", async () => {
    const { stdout, exitCode } = await listWithStatus(404, {});
    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: REPO_NOT_FOUND");
    expect(stdout).toContain("testowner/testrepo");
  });

  it("maps 422 to VALIDATION_ERROR with the body message and exit code 2", async () => {
    const { stdout, exitCode } = await listWithStatus(422, {
      message: "state must be one of open, closed, all",
    });
    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("state must be one of");
  });

  it("maps 429 to RATE_LIMITED with exit code 1", async () => {
    const { stdout, exitCode } = await listWithStatus(429, {});
    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: RATE_LIMITED");
    expect(stdout).toMatch(/help\[\d+\]:.*retry/i);
  });

  it("maps unexpected statuses to UNKNOWN with exit code 1", async () => {
    const { stdout, exitCode } = await listWithStatus(500, { message: "internal error" });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: UNKNOWN");
    expect(stdout).toContain("internal error");
  });

  it("errors are TOON error blocks on stdout", async () => {
    const { stdout } = await listWithStatus(403, { message: "no access" });
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("error: no access");
    expect(lines[1]).toBe("code: FORBIDDEN");
    expect(lines[2]).toMatch(/^help\[\d+\]:/);
  });
});
