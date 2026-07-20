import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CliResult, runCliTest } from "./harness.js";

let tempHome: string;

afterEach(() => {
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

/**
 * Run `body` with `process.env.PATH` replaced. `setup hooks` reads PATH from the
 * process rather than the injected environment, because it has to agree with
 * the agent SDK's own probing — so this is the seam that decides whether the
 * recorded hook command is the bare name or the absolute entrypoint path.
 */
async function withPath(path: string, body: () => Promise<CliResult>): Promise<CliResult> {
  const original = process.env.PATH;
  process.env.PATH = path;
  try {
    return await body();
  } finally {
    process.env.PATH = original;
  }
}

/**
 * The entrypoint `setup hooks` resolves for itself — `src/main.js` here, since
 * the dist layout mirrors src/ and setup.ts locates it relative to its own
 * module.
 */
function entrypointPath(): string {
  return fileURLToPath(new URL("../src/main.js", import.meta.url));
}

/** Write an executable `gitea-axi` into a fresh `dir`, and return that dir. */
function writeFakeBinary(dir: string, contents: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "gitea-axi"), contents, { mode: 0o755 });
  return dir;
}

/** The single command string recorded in the Claude Code SessionStart hook. */
function recordedHookCommand(home: string): string {
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  expect(settings.hooks.SessionStart).toHaveLength(1);
  expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
  return settings.hooks.SessionStart[0].hooks[0].command;
}

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

  it("records the bare binary name when a wrapper on PATH runs this entrypoint", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    // A wrapper-based install in miniature — a script that *invokes* the
    // entrypoint, so its realpath is itself and the SDK could never match it
    // from the entrypoint's side. This is the shape Nix installs.
    const binDir = writeFakeBinary(
      join(tempHome, "wrapper"),
      `#!/bin/sh\nexec node ${entrypointPath()} "$@"\n`,
    );

    const { exitCode } = await withPath(`${binDir}${delimiter}${process.env.PATH ?? ""}`, () =>
      runCliTest(["setup", "hooks"], { env: { HOME: tempHome } }),
    );
    expect(exitCode).toBe(0);

    expect(recordedHookCommand(tempHome)).toBe("gitea-axi");
  });

  it("falls back to the absolute entrypoint path when gitea-axi is not on PATH", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const emptyDir = join(tempHome, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const { exitCode } = await withPath(emptyDir, () =>
      runCliTest(["setup", "hooks"], { env: { HOME: tempHome } }),
    );
    expect(exitCode).toBe(0);

    const command = recordedHookCommand(tempHome);
    expect(isAbsolute(command)).toBe(true);
    expect(command).toBe(entrypointPath());
  });

  it("falls back rather than recording a name for some unrelated gitea-axi", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    // Same name on PATH, different program. Recording the bare name here would
    // point the hook at a binary the user never asked to install.
    const binDir = writeFakeBinary(
      join(tempHome, "impostor"),
      "#!/bin/sh\nexec node /somewhere/else/dist/main.js \"$@\"\n",
    );

    const { exitCode } = await withPath(binDir, () =>
      runCliTest(["setup", "hooks"], { env: { HOME: tempHome } }),
    );
    expect(exitCode).toBe(0);

    expect(recordedHookCommand(tempHome)).toBe(entrypointPath());
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
