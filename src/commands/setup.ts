import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installSessionStartHooks } from "axi-sdk-js";
import type { CliDeps } from "../deps.js";
import { axiError } from "../errors.js";
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

async function setupHooks(deps: CliDeps): Promise<string> {
  const home = resolveHome(deps);
  const errors: string[] = [];
  installSessionStartHooks({
    marker: SKILL_NAME,
    binaryNames: [SKILL_NAME],
    execPath: EXEC_PATH,
    homeDir: home,
    // This is an explicit user command, so install unconditionally rather than
    // deferring to the SDK's auto-install safety gate (which is tuned for the
    // inferred dist/bin/<name>.js entrypoint layout gitea-axi does not use).
    shouldInstall: () => true,
    onError: (message) => errors.push(message),
  });

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
