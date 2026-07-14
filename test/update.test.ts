import { describe, expect, it } from "vitest";
import { runCliTest } from "./harness.js";

describe("update (shadowed self-update)", () => {
  it("refuses to self-update: VALIDATION_ERROR, exit 2, npm help line, no SDK UPDATE_ERROR", async () => {
    const { stdout, exitCode } = await runCliTest(["update"]);

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("npm install -g gitea-axi@latest");
    expect(stdout).not.toContain("UPDATE_ERROR");
  });
});
