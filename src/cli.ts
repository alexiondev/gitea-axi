import { readFileSync } from "node:fs";
import { exitCodeForError, runAxiCli, AxiError } from "axi-sdk-js";
import { issueCommand } from "./commands/issue.js";
import { resolveRepoContext } from "./context.js";
import type { CliDeps, GlobalFlags } from "./deps.js";
import { consumeFlagValue, splitFlag } from "./flags.js";
import { renderErrorOutput } from "./render.js";
import { suggestCommand } from "./suggestions.js";

const DESCRIPTION = "Agent-ergonomic CLI for Gitea issues and pull requests";

const TOP_LEVEL_HELP = `usage: gitea-axi <command> [flags]

commands:
  issue list       List issues in the current repository
  issue view       Show a single issue's details
  issue create     Create an issue
  issue comment    Post a comment on an issue or pull request

global flags:
  -R, --repo <OWNER/NAME>   Override the repository detected from the git origin remote
  --login <name>            Select a tea login profile by name
  --help                    Show help (also available on every command)
  -v, --version             Show version

environment:
  GITEA_AXI_REPO    Repository override, as OWNER/NAME
  GITEA_AXI_LOGIN   Login profile override
`;

const GLOBAL_FLAG_NAMES: Record<string, keyof GlobalFlags> = {
  "-R": "repo",
  "--repo": "repo",
  "--login": "login",
};

interface ExtractedArgv {
  argv: string[];
  globals: GlobalFlags;
}

/**
 * Pull the context override flags out of argv before the SDK sees it: they are
 * accepted anywhere on the command line, while the SDK rejects any flag placed
 * before the command.
 */
export function extractGlobalFlags(argv: string[]): ExtractedArgv {
  const globals: GlobalFlags = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = splitFlag(argv[i]!);
    const target = GLOBAL_FLAG_NAMES[flag.name];
    if (!target) {
      rest.push(argv[i]!);
      continue;
    }
    const consumed = consumeFlagValue(argv, i, flag);
    globals[target] = consumed.value;
    i = consumed.lastIndex;
  }
  return { argv: rest, globals };
}

function readVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return packageJson.version;
}

function homeCommand(deps: CliDeps) {
  return async (): Promise<Record<string, unknown>> => {
    const context = await resolveRepoContext(deps);
    return {
      repo: `${context.owner}/${context.name}`,
      help: [
        suggestCommand(context, "issue list", "to list open issues"),
        "Run `gitea-axi --help` to see available commands",
      ],
    };
  };
}

export interface RunCliOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: { write: (chunk: string) => unknown };
}

export async function runCli(options: RunCliOptions): Promise<number> {
  process.exitCode = 0;
  let extracted: ExtractedArgv;
  try {
    extracted = extractGlobalFlags(options.argv);
  } catch (error) {
    const axi = error as AxiError;
    options.stdout.write(`${renderErrorOutput(axi.message, axi.code, axi.suggestions)}\n`);
    process.exitCode = exitCodeForError(error);
    return process.exitCode;
  }
  const deps: CliDeps = {
    env: options.env,
    cwd: options.cwd,
    globals: extracted.globals,
  };
  await runAxiCli({
    description: DESCRIPTION,
    version: readVersion(),
    argv: extracted.argv,
    topLevelHelp: TOP_LEVEL_HELP,
    commands: {
      issue: issueCommand(deps),
    },
    home: homeCommand(deps),
    stdout: options.stdout,
  });
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}
