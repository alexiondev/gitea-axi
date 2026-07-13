import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, testModeEnv } from "./harness.js";

const ISSUE = 7;
const TARGET = 9;
const BLOCKS_PATH = `/api/v1/repos/testowner/testrepo/issues/${ISSUE}/blocks`;
const DEPENDENCIES_PATH = `/api/v1/repos/testowner/testrepo/issues/${ISSUE}/dependencies`;

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

/** A minimal Issue as the relationship endpoints return one. */
function relatedIssue(number: number): Record<string, unknown> {
  return { number, title: `Issue ${number}`, state: "open" };
}

/**
 * Each dependency group is the same command shape over a different endpoint, so
 * the behaviour is asserted once against a parameterised description. `path` is
 * the endpoint the group's list/add/remove all share; `mutationNoun`/`targetKey`
 * are the output field names the spec fixes for the group.
 */
interface GroupCase {
  command: "blocks" | "blocked-by";
  path: string;
  listNoun: string;
  mutationNoun: string;
  targetKey: string;
}

const GROUPS: GroupCase[] = [
  {
    command: "blocks",
    path: BLOCKS_PATH,
    listNoun: "blocked_issues",
    mutationNoun: "blocks",
    targetKey: "blocks",
  },
  {
    command: "blocked-by",
    path: DEPENDENCIES_PATH,
    listNoun: "blocking_issues",
    mutationNoun: "blocked_by",
    targetKey: "blocked_by",
  },
];

for (const group of GROUPS) {
  describe(`issue ${group.command}`, () => {
    it(`list renders the ${group.listNoun} block with a count line`, async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [relatedIssue(TARGET)] },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "list", String(ISSUE)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      // TOON renders list rows in compact tabular form (`9,Issue 9,open`), so
      // the related issue shows up by its title, not a `number:` field line.
      expect(stdout).toContain(`${group.listNoun}[1]`);
      expect(stdout).toContain(`Issue ${TARGET}`);
      expect(stdout).toContain("count: 1 of 1 total");
    });

    it("list renders an explicit empty state when there are none", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [] },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "list", String(ISSUE)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`${group.listNoun}[0]: (none)`);
      expect(stdout).toContain("count: 0");
    });

    it(`add reports ${group.mutationNoun} and posts the target as IssueMeta`, async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [] },
        { method: "POST", path: group.path, body: relatedIssue(TARGET) },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "add", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`${group.mutationNoun}:`);
      expect(stdout).toContain(`issue: ${ISSUE}`);
      expect(stdout).toContain(`${group.targetKey}: ${TARGET}`);
      expect(stdout).not.toContain("already");
      expect(postedBody(server, group.path)).toEqual({
        owner: "testowner",
        repo: "testrepo",
        index: TARGET,
      });
    });

    it("add of an existing relationship returns already: true without posting", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [relatedIssue(TARGET)] },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "add", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("already: true");
      expect(server.requests.some((request) => request.method === "POST")).toBe(false);
    });

    it("remove of an existing relationship deletes it", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [relatedIssue(TARGET)] },
        { method: "DELETE", path: group.path, body: relatedIssue(TARGET) },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "remove", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("removed: true");
      expect(server.requests.some((request) => request.method === "DELETE")).toBe(true);
    });

    it("remove of a nonexistent relationship is an idempotent no-op without deleting", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [] },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "remove", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      // A no-op remove reports the already-reached state, not a deletion it did
      // not perform (mirrors add's `already: true`).
      expect(stdout).toContain("already: true");
      expect(stdout).not.toContain("removed: true");
      expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    });

    it("reports ISSUE_NOT_FOUND when the issue itself does not exist", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, status: 404, body: { message: "issue does not exist" } },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "add", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(1);
      expect(stdout).toContain("code: ISSUE_NOT_FOUND");
      expect(server.requests.some((request) => request.method === "POST")).toBe(false);
    });

    it("surfaces a cycle rejection from Gitea as VALIDATION_ERROR", async () => {
      server = await startFixtureServer([
        { method: "GET", path: group.path, body: [] },
        {
          method: "POST",
          path: group.path,
          status: 422,
          body: { message: "circular dependencies are not allowed" },
        },
      ]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "add", String(ISSUE), String(TARGET)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(2);
      expect(stdout).toContain("code: VALIDATION_ERROR");
      expect(stdout).toContain("circular dependencies are not allowed");
    });

    it("rejects a missing target before calling the API", async () => {
      server = await startFixtureServer([]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "add", String(ISSUE)],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(2);
      expect(stdout).toContain("code: VALIDATION_ERROR");
      expect(server.requests).toHaveLength(0);
    });

    it("prints help with --help without calling the API", async () => {
      server = await startFixtureServer([]);
      const { stdout, exitCode } = await runCliTest(
        ["issue", group.command, "--help"],
        { env: testModeEnv(server.url) },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`usage: gitea-axi issue ${group.command}`);
      expect(server.requests).toHaveLength(0);
    });
  });
}
