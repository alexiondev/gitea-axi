import { describe, expect, it } from "vitest";
import { runCliTest } from "./harness.js";

describe("--help", () => {
  it("prints a top-level flag reference and exits 0", async () => {
    const { stdout, exitCode } = await runCliTest(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi");
    expect(stdout).toContain("issue list");
    expect(stdout).toContain("-R, --repo");
    expect(stdout).toContain("--login");
  });

  it("prints the issue list flag reference and exits 0", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "list", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue list");
    expect(stdout).toContain("--state");
    expect(stdout).toContain("--limit");
  });

  it("prints the issue group help and exits 0", async () => {
    const { stdout, exitCode } = await runCliTest(["issue", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi issue");
    expect(stdout).toContain("list");
  });

  it("prints the pr group help and exits 0", async () => {
    const { stdout, exitCode } = await runCliTest(["pr", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi pr");
    expect(stdout).toContain("create");
    expect(stdout).toContain("comment");
  });

  it("rejects an unknown pr subcommand with exit code 2", async () => {
    const { stdout, exitCode } = await runCliTest(["pr", "frobnicate"]);

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("frobnicate");
  });

  it("prints the version for --version", async () => {
    const { stdout, exitCode } = await runCliTest(["--version"]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects unknown commands with exit code 2", async () => {
    const { stdout, exitCode } = await runCliTest(["frobnicate"]);

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("frobnicate");
  });
});
