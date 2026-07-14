import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { postedBody, runCliTest, testModeEnv } from "./harness.js";

const LABELS_PATH = "/api/v1/repos/testowner/testrepo/labels";

let server: FixtureServer;

afterEach(async () => {
  await server.close();
});

describe("label list", () => {
  it("renders the count line and a labels block of names", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        headers: { "X-Total-Count": "2" },
        body: [
          { id: 11, name: "bug" },
          { id: 22, name: "enhancement" },
        ],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    const lines = stdout.split("\n");
    expect(lines).toContain("count: 2 of 2 total");
    expect(lines).toContain("labels[2]{name}:");
    expect(lines).toContain("  bug");
    expect(lines).toContain("  enhancement");
  });

  it("emits an explicit empty state for a repo with no labels", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        headers: { "X-Total-Count": "0" },
        body: [],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 0 of 0 total");
    expect(stdout).toContain("labels[0]: (none)");
  });

  it("accepts a numeric --limit value", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        headers: { "X-Total-Count": "1" },
        body: [{ id: 11, name: "bug" }],
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "list", "--limit", "5"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 1 of 1 total");
  });

  it("propagates a 403 from the labels API as a FORBIDDEN error", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        status: 403,
        body: { message: "forbidden" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "list"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
  });
});

describe("label create", () => {
  it("creates the label, prepending # to the color, and reports success", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [] },
      {
        method: "POST",
        path: LABELS_PATH,
        status: 201,
        body: { id: 5, name: "bug", color: "#ff0000" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "create", "--name", "bug", "--color", "ff0000"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedBody(server, LABELS_PATH)).toEqual({ name: "bug", color: "#ff0000" });
    expect(stdout).toContain("created: ok");
    expect(stdout).toContain("label: bug");
  });

  it("is idempotent: an existing label (case-insensitive) is not re-created", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "create", "--name", "BUG", "--color", "ff0000"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("create: already_exists");
    expect(stdout).toContain("label: bug");
    expect(server.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("passes --description through in the POST body", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [] },
      {
        method: "POST",
        path: LABELS_PATH,
        status: 201,
        body: { id: 5, name: "bug" },
      },
    ]);
    const { exitCode } = await runCliTest(
      ["label", "create", "--name", "bug", "--color", "ff0000", "--description", "A bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    expect(postedBody(server, LABELS_PATH)).toEqual({
      name: "bug",
      color: "#ff0000",
      description: "A bug",
    });
  });

  it("propagates a 403 on the create call as a FORBIDDEN error", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [] },
      {
        method: "POST",
        path: LABELS_PATH,
        status: 403,
        body: { message: "forbidden" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "create", "--name", "bug", "--color", "ff0000"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
  });
});

describe("label edit", () => {
  it("resolves the positional by name, PATCHes by id with # prepended to color", async () => {
    server = await startFixtureServer([
      {
        method: "GET",
        path: LABELS_PATH,
        body: [{ id: 11, name: "bug", color: "ff0000" }],
      },
      {
        method: "PATCH",
        path: `${LABELS_PATH}/11`,
        status: 200,
        body: { id: 11, name: "defect", color: "#00ff00", description: "A bug" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      [
        "label", "edit", "bug",
        "--name", "defect",
        "--color", "00ff00",
        "--description", "A bug",
      ],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const patch = server.requests.find(
      (r) => r.method === "PATCH" && r.path === `${LABELS_PATH}/11`,
    );
    expect(patch?.body).toMatchObject({
      name: "defect",
      color: "#00ff00",
      description: "A bug",
    });
    expect(stdout).toContain("edit: ok");
    expect(stdout).toContain("label: defect");
  });

  it("rejects an unknown label name with a VALIDATION_ERROR and no mutation", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "edit", "ghost", "--name", "x"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(
      server.requests.some((r) => r.method === "PATCH" || r.method === "DELETE"),
    ).toBe(false);
  });

  it("PATCHes only the provided field when just --color is given", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
      {
        method: "PATCH",
        path: `${LABELS_PATH}/11`,
        status: 200,
        body: { id: 11, name: "bug", color: "#00ff00" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "edit", "bug", "--color", "00ff00"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(0);
    const patch = server.requests.find(
      (r) => r.method === "PATCH" && r.path === `${LABELS_PATH}/11`,
    );
    expect(patch?.body).toEqual({ color: "#00ff00" });
    expect(stdout).toContain("edit: ok");
    expect(stdout).toContain("label: bug");
  });
});

describe("label delete", () => {
  it("resolves the positional by name and DELETEs by id", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
      { method: "DELETE", path: `${LABELS_PATH}/11`, status: 204 },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "delete", "bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(
      server.requests.some(
        (r) => r.method === "DELETE" && r.path === `${LABELS_PATH}/11`,
      ),
    ).toBe(true);
    expect(stdout).toContain("delete: ok");
    expect(stdout).toContain("label: bug");
  });

  it("rejects an unknown label name with a VALIDATION_ERROR and no mutation", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "delete", "ghost"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(
      server.requests.some((r) => r.method === "PATCH" || r.method === "DELETE"),
    ).toBe(false);
  });

  it("propagates a 403 on the delete call as a FORBIDDEN error", async () => {
    server = await startFixtureServer([
      { method: "GET", path: LABELS_PATH, body: [{ id: 11, name: "bug" }] },
      {
        method: "DELETE",
        path: `${LABELS_PATH}/11`,
        status: 403,
        body: { message: "forbidden" },
      },
    ]);
    const { stdout, exitCode } = await runCliTest(["label", "delete", "bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: FORBIDDEN");
  });
});

describe("label help and dispatch", () => {
  it("prints group usage when no subcommand is given", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label <command>");
    expect(server.requests).toHaveLength(0);
  });

  it("prints group usage for label --help", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label <command>");
    expect(server.requests).toHaveLength(0);
  });

  it("prints subcommand usage for label list --help", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "list", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label list");
    expect(server.requests).toHaveLength(0);
  });

  it("prints subcommand usage for label create --help", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "create", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label create");
    expect(server.requests).toHaveLength(0);
  });

  it("prints subcommand usage for label edit --help", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "edit", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label edit");
    expect(server.requests).toHaveLength(0);
  });

  it("prints subcommand usage for label delete --help", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "delete", "--help"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi label delete");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects an unknown label subcommand", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "bogus"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("Unknown label command: bogus");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects an unexpected positional on label list", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "list", "extra"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("Unexpected argument: extra");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a non-numeric --limit on label list", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "list", "--limit", "abc"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("Invalid --limit value");
    expect(server.requests).toHaveLength(0);
  });

  it("requires --name on label create", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "create"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("label create requires --name");
    expect(server.requests).toHaveLength(0);
  });

  it("requires --color on label create", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(
      ["label", "create", "--name", "bug"],
      { env: testModeEnv(server.url) },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("label create requires --color");
    expect(server.requests).toHaveLength(0);
  });

  it("requires at least one change flag on label edit", async () => {
    server = await startFixtureServer([]);
    const { stdout, exitCode } = await runCliTest(["label", "edit", "bug"], {
      env: testModeEnv(server.url),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("label edit requires at least one change");
    expect(server.requests).toHaveLength(0);
  });
});
