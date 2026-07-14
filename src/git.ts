import type { CliDeps } from "./deps.js";
import { axiError } from "./errors.js";
import { runSubprocess, type SubprocessResult } from "./subprocess.js";

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

/**
 * The branch currently checked out, or null when git cannot name one — it is
 * absent, this is not a repository, or HEAD is detached. Every null case is
 * repaired the same way, by the caller naming the branch explicitly, so they
 * are not distinguished here.
 */
export async function currentBranch(deps: CliDeps): Promise<string | null> {
  const result = await runSubprocess("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: deps.cwd,
    env: deps.env,
  });
  if (result.enoent || result.code !== 0) {
    return null;
  }
  const branch = result.stdout.trim();
  // A detached HEAD abbreviates to the literal "HEAD", which is no branch.
  return branch && branch !== "HEAD" ? branch : null;
}

/** git's first non-empty stderr line — the diagnostic surfaced in a GIT_ERROR. */
function firstStderrLine(stderr: string): string {
  for (const line of stderr.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

/**
 * Run git, mapping a spawn failure or non-zero exit to `GIT_ERROR` carrying
 * git's first stderr line and the caller's remediation help. `help` names the
 * specific fix for the step that failed, so each git step can point at its own.
 */
export async function runGit(
  deps: CliDeps,
  args: string[],
  help: string[],
  fallbackMessage?: string,
): Promise<SubprocessResult> {
  const result = await runSubprocess("git", args, { cwd: deps.cwd, env: deps.env });
  if (result.enoent) {
    throw axiError("git is not installed or not on the PATH", "GIT_ERROR", [
      "Install git and ensure it is available on the PATH",
    ]);
  }
  if (result.code !== 0) {
    throw axiError(
      firstStderrLine(result.stderr) ||
        fallbackMessage ||
        `git ${args[0] ?? ""} exited with a non-zero status`,
      "GIT_ERROR",
      help,
    );
  }
  return result;
}

/** Whether a local branch of this name exists in the working tree's repository. */
export async function branchExists(deps: CliDeps, branch: string): Promise<boolean> {
  const result = await runSubprocess(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: deps.cwd, env: deps.env },
  );
  return !result.enoent && result.code === 0;
}

/**
 * Check out a pull request's head commit into a local branch, fetching it from
 * origin under `refs/pull/{number}/head` — the ref the base repo exposes for
 * same-repo and fork PRs alike (ADR 0011). Three-cased on the local branch's
 * state so re-running is idempotent:
 *  - absent: fetch into the branch, then check it out;
 *  - present but not checked out: force-fetch (the local branch is defined as a
 *    mirror of the PR head), then check it out;
 *  - currently checked out: fetch the ref, then fast-forward merge — local
 *    commits that diverge from the PR head fail with `GIT_ERROR` rather than
 *    being discarded silently.
 */
export async function checkoutPullHead(
  deps: CliDeps,
  number: number,
  branch: string,
): Promise<void> {
  const ref = `pull/${number}/head`;
  const fetchHelp = [
    "Check your network connection and that `origin` points at the Gitea instance",
  ];

  const current = await currentBranch(deps);
  if (current === branch) {
    await runGit(deps, ["fetch", "origin", ref], fetchHelp);
    // A ff-only merge fails when local commits diverge from the PR head; that
    // surfaces as GIT_ERROR with divergence-specific help, never discarding them.
    await runGit(
      deps,
      ["merge", "--ff-only", "FETCH_HEAD"],
      [
        `The checked-out ${branch} has local commits that are not on the PR head, so it cannot fast-forward — they were left intact`,
        "Reconcile them (e.g. `git rebase FETCH_HEAD`), or reset the branch once you have preserved them",
      ],
      "git merge --ff-only could not fast-forward",
    );
    return;
  }

  // A fresh branch is fetched into directly; an existing one is force-updated,
  // since it is a mirror of the PR head and a moved head is not fast-forwardable.
  const exists = await branchExists(deps, branch);
  const refspec = exists ? `+${ref}:${branch}` : `${ref}:${branch}`;
  await runGit(deps, ["fetch", "origin", refspec], fetchHelp);
  await runGit(deps, ["checkout", branch], [
    `Commit or stash your changes before checking out ${branch}`,
  ]);
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
