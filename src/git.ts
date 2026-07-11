import type { CliDeps } from "./deps.js";
import { runSubprocess } from "./subprocess.js";

export interface RemoteRepo {
  host: string;
  owner: string;
  name: string;
}

function parseRepoPath(rawPath: string): { owner: string; name: string } | null {
  const path = rawPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  const segments = path.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return null;
  }
  return { owner: segments[0], name: segments[1] };
}

export function parseRemoteUrl(url: string): RemoteRepo | null {
  const trimmed = url.trim();
  if (/^(https?|ssh):\/\//.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const repo = parseRepoPath(parsed.pathname);
    if (!repo || !parsed.hostname) {
      return null;
    }
    return { host: parsed.hostname, ...repo };
  }
  // scp-like SSH form: [user@]host:owner/name[.git]
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp) {
    const repo = parseRepoPath(scp[2]!);
    if (!repo) {
      return null;
    }
    return { host: scp[1]!, ...repo };
  }
  return null;
}

export async function detectRemote(deps: CliDeps): Promise<RemoteRepo | null> {
  const result = await runSubprocess("git", ["remote", "get-url", "origin"], {
    cwd: deps.cwd,
    env: deps.env,
  });
  if (result.enoent || result.code !== 0) {
    return null;
  }
  return parseRemoteUrl(result.stdout);
}
