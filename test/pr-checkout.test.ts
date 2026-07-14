import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest, testModeEnv } from "./harness.js";

let server: FixtureServer;
const tempDirs: string[] = [];

afterEach(async () => {
  await server.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
    stdio: "pipe",
  });
}

/**
 * Build an `origin` bare repo whose PR-head commit is published ONLY under
 * `refs/pull/<prNumber>/head` (never as a normal branch), plus a working clone
 * pointed at it, so `pr checkout` needs no network. Returns the working dir, the
 * seed clone (to advance the PR head), and the sha of the PR-head commit.
 */
function makeScratchRepo(prNumber = 1): {
  workDir: string;
  seedDir: string;
  headSha: string;
} {
  const root = mkdtempSync(join(tmpdir(), "gitea-axi-checkout-"));
  tempDirs.push(root);

  const originDir = join(root, "origin.git");
  git(root, "init", "--bare", "-b", "main", "origin.git");

  const seed = join(root, "seed");
  git(root, "clone", originDir, "seed");
  writeFileSync(join(seed, "file.txt"), "base\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "base");
  git(seed, "push", "origin", "main");

  writeFileSync(join(seed, "file.txt"), "pr head\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "pr head");
  git(seed, "push", "origin", `HEAD:refs/pull/${prNumber}/head`);
  const headSha = git(seed, "rev-parse", "HEAD").toString().trim();

  const workDir = join(root, "work");
  git(root, "clone", originDir, "work");
  return { workDir, seedDir: seed, headSha };
}

describe("pr checkout", () => {
  it("fetches refs/pull/<n>/head into a branch named after head.ref and checks it out", async () => {
    const { workDir } = makeScratchRepo();
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/1",
        body: { number: 1, head: { ref: "feature" } },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("checkout:");
    expect(stdout).toContain("number: 1");
    expect(stdout).toContain("branch: feature");
    expect(stdout).toContain("status: ok");
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "feature",
    );
  });

  it("force-updates a pre-existing, non-checked-out local branch to the PR head and checks it out", async () => {
    const { workDir, headSha } = makeScratchRepo();
    // A stale local `feature` branch sits at the base commit while HEAD stays on main.
    git(workDir, "branch", "feature", "main");

    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/1",
        body: { number: 1, head: { ref: "feature" } },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("checkout:");
    expect(stdout).toContain("branch: feature");
    expect(stdout).toContain("status: ok");
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "feature",
    );
    expect(git(workDir, "rev-parse", "feature").toString().trim()).toBe(headSha);
  });

  it("fast-forwards the already-checked-out PR branch to an advanced head and is idempotent on re-run", async () => {
    const { workDir, seedDir } = makeScratchRepo();
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/1",
        body: { number: 1, head: { ref: "feature" } },
      },
    ]);

    // First checkout lands on `feature` at the original PR head.
    const first = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });
    expect(first.exitCode).toBe(0);
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "feature",
    );

    // Advance the PR head on origin to a new commit.
    writeFileSync(join(seedDir, "file.txt"), "advanced pr head\n");
    git(seedDir, "add", "-A");
    git(seedDir, "commit", "-m", "advanced pr head");
    const newSha = git(seedDir, "rev-parse", "HEAD").toString().trim();
    git(seedDir, "push", "-f", "origin", "HEAD:refs/pull/1/head");

    // Second checkout fast-forwards the checked-out branch to the advanced head.
    const second = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("status: ok");
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "feature",
    );
    expect(git(workDir, "rev-parse", "feature").toString().trim()).toBe(newSha);

    // Third checkout with no further change is a successful no-op.
    const third = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });
    expect(third.exitCode).toBe(0);
    expect(third.stdout).toContain("status: ok");
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "feature",
    );
    expect(git(workDir, "rev-parse", "feature").toString().trim()).toBe(newSha);
  });

  it("fails with GIT_ERROR and preserves local commits when the checked-out branch diverges", async () => {
    const { workDir, seedDir } = makeScratchRepo();
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/1",
        body: { number: 1, head: { ref: "feature" } },
      },
    ]);

    // First checkout lands on `feature` at the PR head.
    const first = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });
    expect(first.exitCode).toBe(0);

    // Move the PR head elsewhere on origin.
    writeFileSync(join(seedDir, "file.txt"), "advanced pr head\n");
    git(seedDir, "add", "-A");
    git(seedDir, "commit", "-m", "advanced pr head");
    git(seedDir, "push", "-f", "origin", "HEAD:refs/pull/1/head");

    // Make a local commit on `feature` that is not on the PR head → divergence.
    writeFileSync(join(workDir, "local.txt"), "local work\n");
    git(workDir, "add", "-A");
    git(workDir, "commit", "-m", "local work");
    const localSha = git(workDir, "rev-parse", "HEAD").toString().trim();

    const { stdout, exitCode } = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: GIT_ERROR");
    expect(stdout).toContain("local commits that are not on the PR head");
    expect(stdout).toContain("cannot fast-forward");
    // The local commit is intact; nothing was discarded.
    expect(git(workDir, "rev-parse", "HEAD").toString().trim()).toBe(localSha);
  });

  it("maps an ordinary git failure (unreachable origin) to GIT_ERROR carrying git's stderr", async () => {
    const { workDir } = makeScratchRepo();
    // Break the fetch: remove origin so the first `git fetch origin ...` fails.
    git(workDir, "remote", "remove", "origin");

    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/1",
        body: { number: 1, head: { ref: "feature" } },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "checkout", "1"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: GIT_ERROR");
    // Git's own first stderr line is surfaced; assert an invariant fragment.
    expect(stdout).toContain("'origin' does not appear to be a git repository");
  });

  it("checks out a fork PR whose head exists only under refs/pull/<n>/head, not as a branch", async () => {
    const { workDir, headSha } = makeScratchRepo(2);
    // `fork-feature` exists nowhere as a branch — only inside refs/pull/2/head.
    server = await startFixtureServer([
      {
        method: "GET",
        path: "/api/v1/repos/testowner/testrepo/pulls/2",
        body: { number: 2, head: { ref: "fork-feature" } },
      },
    ]);

    const { stdout, exitCode } = await runCliTest(["pr", "checkout", "2"], {
      env: { ...process.env, ...testModeEnv(server.url) },
      cwd: workDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("checkout:");
    expect(stdout).toContain("number: 2");
    expect(stdout).toContain("branch: fork-feature");
    expect(stdout).toContain("status: ok");
    expect(git(workDir, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()).toBe(
      "fork-feature",
    );
    expect(git(workDir, "rev-parse", "fork-feature").toString().trim()).toBe(headSha);
  });
});
