import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

const ISSUE_PATH = "/api/v1/repos/testowner/testrepo/issues/7";
const PIN_PATH = "/api/v1/repos/testowner/testrepo/issues/7/pin";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("issue pin", () => {
  it("pins an unpinned issue and reports the pinned state", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
      { method: "POST", path: PIN_PATH, status: 204 },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "pin", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("issue:");
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("state: open");
    expect(stdout).toContain("pinned: true");
    expect(server.requests.some((request) => request.method === "POST")).toBe(true);
  });

  it("returns early with Already pinned on an already-pinned issue", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open", pin_order: 1 } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "pin", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("message: Already pinned");
    expect(server.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "pin", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue pin");
    expect(server.requests).toHaveLength(0);
  });
});

describe("issue unpin", () => {
  it("unpins a pinned issue and reports the unpinned state", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open", pin_order: 1 } },
      { method: "DELETE", path: PIN_PATH, status: 204 },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "unpin", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("number: 7");
    expect(stdout).toContain("pinned: false");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("returns early with Already unpinned on an issue that is not pinned", async () => {
    server = await startFixtureServer([
      { method: "GET", path: ISSUE_PATH, body: { number: 7, state: "open" } },
    ]);
    const { stdout, exitCode } = await runCliTest(["issue", "unpin", "7"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("message: Already unpinned");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("prints help with --help without calling the API", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["issue", "unpin", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue unpin");
    expect(server.requests).toHaveLength(0);
  });
});
