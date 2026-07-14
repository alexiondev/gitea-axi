import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliTest } from "./harness.js";

let tempHome: string;

afterEach(() => {
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe("setup", () => {
  it("installs the skill and is idempotent: installed -> unchanged -> updated", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const installedPath = join(tempHome, ".claude", "skills", "gitea-axi", "SKILL.md");

    // 1. First run on a clean HOME → installed, file now on disk.
    const first = await runCliTest(["setup"], { env: { HOME: tempHome } });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("setup:");
    expect(first.stdout).toContain("skill: gitea-axi");
    expect(first.stdout).toContain("status: installed");
    expect(existsSync(installedPath)).toBe(true);

    // 2. Immediate second run, nothing changed → unchanged, still exit 0.
    const second = await runCliTest(["setup"], { env: { HOME: tempHome } });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("status: unchanged");

    // 3. Tamper with the installed file → next run reports updated and restores it.
    writeFileSync(installedPath, "tampered");
    const third = await runCliTest(["setup"], { env: { HOME: tempHome } });
    expect(third.exitCode).toBe(0);
    expect(third.stdout).toContain("status: updated");
    expect(readFileSync(installedPath, "utf8")).not.toBe("tampered");
  });
});

describe("setup hooks", () => {
  it("registers the SessionStart hook for all three integrations and reports a restart hint", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    const { stdout, exitCode } = await runCliTest(["setup", "hooks"], {
      env: { HOME: tempHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("hooks:");
    expect(stdout).toContain("status: installed");
    expect(stdout).toContain("Claude Code");
    expect(stdout).toContain("Codex");
    expect(stdout).toContain("OpenCode");
    expect(stdout.toLowerCase()).toContain("restart");

    // Claude Code: settings.json with a non-empty SessionStart hook array.
    const claudeSettingsPath = join(tempHome, ".claude", "settings.json");
    expect(existsSync(claudeSettingsPath)).toBe(true);
    const claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
    expect(Array.isArray(claudeSettings.hooks?.SessionStart)).toBe(true);
    expect(claudeSettings.hooks.SessionStart.length).toBeGreaterThan(0);

    // Codex: hooks.json and config.toml.
    expect(existsSync(join(tempHome, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(tempHome, ".codex", "config.toml"))).toBe(true);

    // OpenCode: plugin file.
    expect(
      existsSync(join(tempHome, ".config", "opencode", "plugins", "axi-gitea-axi.js")),
    ).toBe(true);
  });

  it("updates the managed entry in place on re-run rather than appending a duplicate", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    const first = await runCliTest(["setup", "hooks"], { env: { HOME: tempHome } });
    expect(first.exitCode).toBe(0);

    const second = await runCliTest(["setup", "hooks"], { env: { HOME: tempHome } });
    expect(second.exitCode).toBe(0);

    const claudeSettingsPath = join(tempHome, ".claude", "settings.json");
    const claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
    expect(claudeSettings.hooks.SessionStart).toHaveLength(1);
    expect(claudeSettings.hooks.SessionStart[0].hooks).toHaveLength(1);
  });
});

describe("setup dispatch", () => {
  it("prints setup usage for setup --help", async () => {
    const { stdout, exitCode } = await runCliTest(["setup", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: gitea-axi setup");
  });

  it("rejects an unknown setup subcommand with a VALIDATION_ERROR", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    const { stdout, exitCode } = await runCliTest(["setup", "bogus"], {
      env: { HOME: tempHome },
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("bogus");
  });
});
