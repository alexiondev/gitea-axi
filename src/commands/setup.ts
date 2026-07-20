import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installSessionStartHooks } from "axi-sdk-js";
import type { CliDeps } from "../deps.js";
import { axiError } from "../errors.js";
import { pruneDuplicateManagedHooks, resolveEntrypointOnPath } from "../hooks.js";
import { renderDetail } from "../render.js";

export const SETUP_HELP = `usage: gitea-axi setup [hooks]

Install gitea-axi's ambient context for agent sessions.

  setup            Install the bundled Agent Skill into ~/.claude/skills/
  setup hooks      Also install a SessionStart hook that runs the dashboard at
                   session start (Claude Code, Codex, and OpenCode)

Both are idempotent: re-running updates the managed files in place rather than
failing. There is no postinstall script — installation is always explicit.

flags:
  --help           Show this help
`;

// The bundled Agent Skill and the CLI entrypoint are resolved relative to this
// module so they track the install tree regardless of how the process was
// launched. From dist/commands/setup.js these are ../../skills/... and
// ../main.js (the dist layout mirrors src/, so the same paths resolve in tests).
const SKILL_NAME = "gitea-axi";
const SKILL_SOURCE = new URL("../../skills/gitea-axi/SKILL.md", import.meta.url);
const EXEC_PATH = fileURLToPath(new URL("../main.js", import.meta.url));

// The same string as SKILL_NAME, kept apart because it names a different thing:
// the executable as it is spelled on PATH, which is what the SessionStart hook
// records. They are free to diverge; the SDK's marker follows the skill.
const BINARY_NAME = "gitea-axi";

const HOOK_INTEGRATIONS = ["Claude Code", "Codex", "OpenCode"];

/** The home directory, from the injected env first so tests can point at a temp HOME. */
function resolveHome(deps: CliDeps): string {
  return deps.env.HOME ?? deps.env.USERPROFILE ?? homedir();
}

/** Collapse a leading home directory to `~` for readable output. */
function collapseHome(path: string, home: string): string {
  if (path === home) {
    return "~";
  }
  const prefix = home.endsWith("/") ? home : `${home}/`;
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}

type SkillStatus = "installed" | "updated" | "unchanged";

/**
 * Copy the bundled skill into `~/.claude/skills/gitea-axi/SKILL.md`, idempotently.
 * A missing target is `installed`, a byte-identical one is `unchanged`, and a
 * differing one is overwritten and reported `updated` — re-running never fails.
 */
function installSkill(home: string): { skill: string; path: string; status: SkillStatus } {
  const source = readFileSync(SKILL_SOURCE, "utf8");
  const targetDir = join(home, ".claude", "skills", SKILL_NAME);
  const targetPath = join(targetDir, "SKILL.md");

  let status: SkillStatus;
  if (!existsSync(targetPath)) {
    status = "installed";
  } else {
    status = readFileSync(targetPath, "utf8") === source ? "unchanged" : "updated";
  }

  if (status !== "unchanged") {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, source, "utf8");
  }

  return { skill: SKILL_NAME, path: collapseHome(targetPath, home), status };
}

async function setupSkill(deps: CliDeps): Promise<string> {
  const home = resolveHome(deps);
  const result = installSkill(home);
  return renderDetail({
    noun: "setup",
    item: result,
    help: [
      "Run `gitea-axi setup hooks` to also inject the dashboard at session start",
    ],
  });
}

// The two files the SDK writes the SessionStart hook array into. Its third
// integration, OpenCode, is a whole plugin file it rewrites wholesale behind
// its own managed marker, so that one cannot accumulate duplicates.
const HOOK_SETTINGS_FILES = [
  [".claude", "settings.json"],
  [".codex", "hooks.json"],
];

/**
 * Collapse any duplicate managed entry the SDK's own recognition missed.
 *
 * It identifies its hook by finding the marker inside the recorded command, so
 * an entrypoint path that does not happen to contain "gitea-axi" makes a re-run
 * append a second entry rather than update the first. Matching the exact
 * command this run records makes idempotency independent of the recorded
 * command's shape — and cannot mistake another tool's hook for ours the way a
 * substring test can.
 */
function pruneHookSettingsFiles(home: string, command: string, errors: string[]): void {
  const isManaged = (recorded: string) => recorded === command;

  for (const segments of HOOK_SETTINGS_FILES) {
    const target = join(home, ...segments);
    if (!existsSync(target)) {
      continue;
    }
    try {
      const current = JSON.parse(readFileSync(target, "utf8"));
      const { settings, changed } = pruneDuplicateManagedHooks(current, isManaged);
      if (changed) {
        writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      }
    } catch (error) {
      errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function setupHooks(deps: CliDeps): Promise<string> {
  const home = resolveHome(deps);
  const errors: string[] = [];

  // ADR 0019: record a search-path name, not an install-tree path. Handing the
  // SDK where the binary resolves on PATH — rather than the module-relative
  // entrypoint — is what lets its realpath test succeed for a wrapper-based
  // install, so it records the bare, upgrade-stable name. When the name
  // resolves to no wrapper or symlink of ours, the entrypoint stands as the
  // fallback and the absolute path is recorded exactly as before.
  //
  // PATH is read from the process rather than the injected environment on
  // purpose: it has to be the same PATH the SDK itself probes, and the SDK
  // reads its own.
  const onPath = resolveEntrypointOnPath(BINARY_NAME, EXEC_PATH, process.env.PATH);
  const execPath = onPath ?? EXEC_PATH;
  const command = onPath ? BINARY_NAME : EXEC_PATH;

  installSessionStartHooks({
    marker: SKILL_NAME,
    binaryNames: [SKILL_NAME],
    execPath,
    homeDir: home,
    // This is an explicit user command, so install unconditionally rather than
    // deferring to the SDK's auto-install safety gate (which is tuned for the
    // inferred dist/bin/<name>.js entrypoint layout gitea-axi does not use).
    shouldInstall: () => true,
    onError: (message) => errors.push(message),
  });

  pruneHookSettingsFiles(home, command, errors);

  if (errors.length > 0) {
    throw axiError(`Failed to install session hooks: ${errors.join("; ")}`, "UNKNOWN");
  }

  return renderDetail({
    noun: "hooks",
    item: { status: "installed", integrations: HOOK_INTEGRATIONS },
    help: ["Restart your agent session for the hook to take effect"],
  });
}

/**
 * The `setup` command (ADR 0009): the bundled Agent Skill by default, the opt-in
 * SessionStart hook under `setup hooks`. These touch only the local filesystem —
 * no repository context is resolved and no Gitea request is made.
 */
export function setupCommand(deps: CliDeps) {
  return async (args: string[]): Promise<string> => {
    if (args.includes("--help")) {
      return SETUP_HELP;
    }
    const [subcommand, ...rest] = args;
    if (subcommand === undefined) {
      return setupSkill(deps);
    }
    if (subcommand === "hooks") {
      if (rest.length > 0) {
        throw axiError(`Unexpected argument: ${rest[0]}`, "VALIDATION_ERROR", [
          "Run `gitea-axi setup hooks`",
        ]);
      }
      return setupHooks(deps);
    }
    throw axiError(`Unknown setup command: ${subcommand}`, "VALIDATION_ERROR", [
      "Run `gitea-axi setup --help` to see available setup commands",
    ]);
  };
}
