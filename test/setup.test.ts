import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CliResult, runCliTest } from "./harness.js";

let tempHome: string;

/** Restore write permission everywhere under `dir` so the tree can be removed. */
function restorePermissions(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    chmodSync(path, entry.isDirectory() ? 0o700 : 0o600);
    if (entry.isDirectory()) {
      restorePermissions(path);
    }
  }
}

afterEach(() => {
  // Not every test creates a HOME, so this may be a directory an earlier test
  // already removed.
  if (tempHome && existsSync(tempHome)) {
    // The read-only-target tests leave files and directories unwritable, and
    // an unwritable directory cannot have its entries unlinked.
    chmodSync(tempHome, 0o700);
    restorePermissions(tempHome);
    rmSync(tempHome, { recursive: true, force: true });
  }
  tempHome = "";
});

/**
 * Permission bits are not enforced for root, so the read-only-target tests
 * cannot express their premise there and are skipped rather than passing
 * vacuously.
 */
const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

/**
 * Assert the error's wording infers no particular configuration manager.
 *
 * Read-only is not diagnostic of one, so naming one would be wrong for most
 * readers who hit this. The paths the error quotes are exempt — they are the
 * user's own, and here the temp directory sits under a `nix-shell` TMPDIR.
 */
function expectNamesNoManager(stdout: string, home: string): void {
  const wording = stdout.split(home).join("<home>");
  expect(wording).not.toMatch(/\b(nix|home-manager|nixos|chezmoi|ansible|stow|guix)\b/i);
}

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

/**
 * The SessionStart entry declared in `session-start-hook.json`, the committed
 * specification the Nix home-manager module writes into a declarative
 * configuration.
 *
 * That module and this command are two ways to arrive at the same entry, with
 * nothing structural keeping them agreed — so the specification is read here
 * rather than restated, and the assertion below is what holds them together. It
 * fails if either side drifts, including if the agent SDK changes the envelope
 * it writes out from under the imperative path.
 */
function declaredSessionStartEntry(): unknown {
  return JSON.parse(
    readFileSync(new URL("../session-start-hook.json", import.meta.url), "utf8"),
  );
}

/**
 * Run `setup hooks` with a wrapper-based install of this entrypoint on PATH.
 *
 * That is a wrapper-based install in miniature — a script that *invokes* the
 * entrypoint, so its realpath is itself and the agent SDK could never match it
 * from the entrypoint's side — and it is the shape every real install produces,
 * Nix's included. It is also the only arrangement in which the bare name gets
 * recorded, so any assertion about that name has to arrange it first.
 */
async function installHooksBehindWrapper(home: string): Promise<void> {
  const binDir = writeFakeBinary(
    join(home, "wrapper"),
    `#!/bin/sh\nexec node ${entrypointPath()} "$@"\n`,
  );

  const { exitCode } = await withPath(`${binDir}${delimiter}${process.env.PATH ?? ""}`, () =>
    runCliTest(["setup", "hooks"], { env: { HOME: home } }),
  );
  expect(exitCode).toBe(0);
}

/** The Claude Code settings the hook install wrote into `home`. */
function claudeSettings(home: string) {
  return JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
}

/** The single command string recorded in the Claude Code SessionStart hook. */
function recordedHookCommand(home: string): string {
  const settings = claudeSettings(home);
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

  itUnlessRoot("reports a read-only skill target as a structured error", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const installedPath = join(tempHome, ".claude", "skills", "gitea-axi", "SKILL.md");

    // A declaratively managed install in miniature: the file is present, its
    // content differs from the bundled copy, and it cannot be written.
    mkdirSync(join(tempHome, ".claude", "skills", "gitea-axi"), { recursive: true });
    writeFileSync(installedPath, "managed elsewhere\n");
    chmodSync(installedPath, 0o444);

    const { stdout, exitCode } = await runCliTest(["setup"], { env: { HOME: tempHome } });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: TARGET_NOT_WRITABLE");
    expect(stdout).toContain(installedPath);
    expect(stdout).toContain("managed by another tool");
    expectNamesNoManager(stdout, tempHome);
    // The bundled copy is untouched by a failed run.
    expect(readFileSync(installedPath, "utf8")).toBe("managed elsewhere\n");
  });

  itUnlessRoot("names the directory when it is the directory that is read-only", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const skillsDir = join(tempHome, ".claude", "skills");

    // Nothing installed yet, and no new entry can be created here — so the
    // blocked path is the directory, not the file that would have gone in it.
    mkdirSync(skillsDir, { recursive: true });
    chmodSync(skillsDir, 0o555);

    const { stdout, exitCode } = await runCliTest(["setup"], { env: { HOME: tempHome } });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: TARGET_NOT_WRITABLE");
    expect(stdout).toContain(join(skillsDir, "gitea-axi"));
    expectNamesNoManager(stdout, tempHome);
  });

  itUnlessRoot("succeeds on a read-only skill target that is already up to date", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const installedPath = join(tempHome, ".claude", "skills", "gitea-axi", "SKILL.md");

    const first = await runCliTest(["setup"], { env: { HOME: tempHome } });
    expect(first.exitCode).toBe(0);

    // Same bytes the command would write, so there is nothing to write and the
    // target's being read-only is beside the point.
    chmodSync(installedPath, 0o444);

    const { stdout, exitCode } = await runCliTest(["setup"], { env: { HOME: tempHome } });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("status: unchanged");
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

    const settings = claudeSettings(tempHome);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  it("records the bare binary name when a wrapper on PATH runs this entrypoint", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    await installHooksBehindWrapper(tempHome);

    expect(recordedHookCommand(tempHome)).toBe("gitea-axi");
  });

  it("writes exactly the SessionStart entry the packaged specification declares", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));

    await installHooksBehindWrapper(tempHome);

    expect(claudeSettings(tempHome).hooks.SessionStart).toEqual([declaredSessionStartEntry()]);
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

  itUnlessRoot("reports a read-only hook target as the same structured error", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "gitea-axi-setup-"));
    const settingsPath = join(tempHome, ".claude", "settings.json");

    mkdirSync(join(tempHome, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{}\n");
    chmodSync(settingsPath, 0o444);

    const { stdout, exitCode } = await runCliTest(["setup", "hooks"], {
      env: { HOME: tempHome },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: TARGET_NOT_WRITABLE");
    expect(stdout).toContain(settingsPath);
    expect(stdout).toContain("managed by another tool");
    expectNamesNoManager(stdout, tempHome);
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
