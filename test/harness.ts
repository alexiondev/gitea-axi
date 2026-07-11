import { runCli } from "../src/cli.js";

export interface CliResult {
  stdout: string;
  exitCode: number;
}

export interface CliTestOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

/**
 * Drive the CLI seam: argv in, stdout and exit code out. The environment is
 * fully explicit — nothing leaks in from the test process's own env.
 */
export async function runCliTest(
  argv: string[],
  options: CliTestOptions = {},
): Promise<CliResult> {
  let stdout = "";
  const exitCode = await runCli({
    argv,
    env: options.env ?? {},
    cwd: options.cwd ?? process.cwd(),
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
      },
    },
  });
  process.exitCode = 0;
  return { stdout, exitCode };
}

export function testModeEnv(apiUrl: string): Record<string, string> {
  return {
    GITEA_AXI_API_URL: apiUrl,
    GITEA_AXI_TOKEN: "test-token",
    GITEA_AXI_REPO: "testowner/testrepo",
  };
}
