import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, tempFiles, testModeEnv, type TempFiles } from "./harness.js";

const REPO_PATH = "/api/v1/repos/testowner/testrepo";
const REVIEWS_PATH = `${REPO_PATH}/pulls/9/reviews`;

let server: FixtureServer;
const files: TempFiles = tempFiles();

afterEach(async () => {
  await server.close();
  files.cleanup();
});

function reviewPosted() {
  return server.requests.find(
    (request) => request.method === "POST" && request.path === REVIEWS_PATH,
  );
}

describe("pr review", () => {
  it("submits an APPROVED review and reports number and action for --approve", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", "--approve"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event: "APPROVED" });
    expect(stdout).toContain("review:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain("action: approve");
  });

  it.each([
    ["--request-changes", "REQUEST_CHANGES", "request-changes"],
    ["--comment", "COMMENT", "comment"],
  ])("submits %s as event %s and reports action %s", async (flag, event, action) => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", flag], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event });
    expect(stdout).toContain("review:");
    expect(stdout).toContain("number: 9");
    expect(stdout).toContain(`action: ${action}`);
  });

  it("rejects zero action flags before any API call", async () => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it.each([
    ["--approve", "--comment"],
    ["--approve", "--request-changes"],
    ["--request-changes", "--comment"],
  ])("rejects multiple action flags (%s %s) before any API call", async (...actions) => {
    server = await startFixtureServer([]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", ...actions], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(server.requests).toHaveLength(0);
  });

  it("surfaces a 422 from the server as VALIDATION_ERROR carrying its message", async () => {
    server = await startFixtureServer([
      {
        method: "POST",
        path: REVIEWS_PATH,
        status: 422,
        body: { message: "review body cannot be empty" },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "review", "9", "--request-changes"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("review body cannot be empty");
  });

  it("forwards a --body review body inline", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);

    const { exitCode } = await runCliTest(
      ["pr", "review", "9", "--comment", "--body", "Looks good"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({ event: "COMMENT", body: "Looks good" });
  });

  it("forwards a --body-file review body from the file contents", async () => {
    server = await startFixtureServer([{ method: "POST", path: REVIEWS_PATH, body: {} }]);
    const path = files.write("review.txt", "Please fix the tests");

    const { exitCode } = await runCliTest(
      ["pr", "review", "9", "--request-changes", "--body-file", path],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(reviewPosted()?.body).toEqual({
      event: "REQUEST_CHANGES",
      body: "Please fix the tests",
    });
  });
});
