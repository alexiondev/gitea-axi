import { spawn } from "node:child_process";

export interface SubprocessResult {
  enoent: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SubprocessOptions {
  cwd?: string;
  env: Record<string, string | undefined>;
  stdin?: string;
}

export function runSubprocess(
  command: string,
  args: string[],
  options: SubprocessOptions,
): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({ enoent: true, code: null, stdout, stderr });
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      resolve({ enoent: false, code, stdout, stderr });
    });
    if (options.stdin !== undefined) {
      // The child may exit without reading stdin; a late write then raises
      // EPIPE, which must not crash the parent.
      child.stdin.on("error", () => {});
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}
