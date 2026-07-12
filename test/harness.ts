import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { runCli } from "../src/cli.js";
import type { FixtureServer } from "./fixture-server.js";

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

/**
 * Throwaway files for the `--body-file` paths, cleaned up together. Call
 * {@link TempFiles.write} to create one and {@link TempFiles.cleanup} from an
 * `afterEach`.
 */
export interface TempFiles {
  write: (name: string, content: string) => string;
  cleanup: () => void;
}

export function tempFiles(): TempFiles {
  const dirs: string[] = [];
  return {
    write: (name, content) => {
      const dir = mkdtempSync(join(tmpdir(), "gitea-axi-test-"));
      dirs.push(dir);
      const path = join(dir, name);
      writeFileSync(path, content, "utf8");
      return path;
    },
    cleanup: () => {
      for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** The parsed body of the single POST the CLI sent to `path`; fails if it sent none. */
export function postedBody(server: FixtureServer, path: string): Record<string, unknown> {
  const post = server.requests.find(
    (request) => request.method === "POST" && request.path === path,
  );
  expect(post, `expected a POST to ${path}`).toBeDefined();
  return post!.body as Record<string, unknown>;
}
