import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { runCliTest } from "./harness.js";

interface FakeLogin {
  name: string;
  url: string;
  ssh_host?: string;
  user?: string;
  default?: string;
}

const root = mkdtempSync(join(tmpdir(), "gitea-axi-detect-"));
const gitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
// The fake tea script needs cat on the sandbox PATH for its heredoc branches.
const catPath = execFileSync("which", ["cat"], { encoding: "utf8" }).trim();
let sandboxCounter = 0;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A PATH dir with real git and optionally a fake tea baked to fixed replies. */
function makeSandbox(options: { logins?: FakeLogin[]; token?: string; tea?: boolean }): string {
  const bin = join(root, `bin-${sandboxCounter++}`);
  mkdirSync(bin);
  symlinkSync(gitPath, join(bin, "git"));
  symlinkSync(catPath, join(bin, "cat"));
  if (options.tea !== false) {
    const script = `#!/bin/sh
if [ "$1" = "login" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
${JSON.stringify(options.logins ?? [])}
JSON
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "helper" ] && [ "$3" = "get" ]; then
  cat > /dev/null
  printf 'protocol=http\\nhost=fixture\\nusername=u\\npassword=%s\\n' '${options.token ?? ""}'
  exit 0
fi
echo "unexpected tea invocation: $*" >&2
exit 1
`;
    writeFileSync(join(bin, "tea"), script, { mode: 0o755 });
  }
  return bin;
}

function makeRepo(remoteUrl: string | undefined): string {
  const dir = join(root, `repo-${sandboxCounter++}`);
  mkdirSync(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  if (remoteUrl) {
    execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir });
  }
  return dir;
}

const ISSUES_PATH = "/api/v1/repos/testowner/testrepo/issues";

let server: FixtureServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startIssuesServer(): Promise<FixtureServer> {
  server = await startFixtureServer([
    {
      method: "GET",
      path: ISSUES_PATH,
      headers: { "X-Total-Count": "3" },
      fixture: "issues-open.json",
    },
  ]);
  return server;
}

describe("repository context detection", () => {
  it("detects the repo from an HTTPS origin remote and authenticates via tea", async () => {
    const { url } = await startIssuesServer();
    const cwd = makeRepo(`${url}/testowner/testrepo.git`);
    const bin = makeSandbox({
      logins: [{ name: "fixture", url, user: "u", default: "true" }],
      token: "detected-token",
    });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 3 of 3 total");
    expect(server!.requests[0]!.headers.authorization).toBe("Bearer detected-token");
    // Auto-detected context: suggestions must not carry override flags.
    expect(stdout).not.toContain("-R testowner/testrepo");
    expect(stdout).not.toContain("--login");
  });

  it("detects the repo from an SSH (scp-form) origin remote", async () => {
    const { url } = await startIssuesServer();
    const cwd = makeRepo("git@127.0.0.1:testowner/testrepo.git");
    const bin = makeSandbox({
      logins: [{ name: "fixture", url, user: "u", default: "true" }],
      token: "detected-token",
    });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("count: 3 of 3 total");
  });

  it("fails with REPO_NOT_FOUND when there is no recognizable origin remote", async () => {
    const cwd = makeRepo(undefined);
    const bin = makeSandbox({ logins: [] });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: REPO_NOT_FOUND");
  });

  it("fails with TEA_NOT_INSTALLED when the tea binary is missing", async () => {
    const cwd = makeRepo("https://gitea.example.com/testowner/testrepo.git");
    const bin = makeSandbox({ tea: false });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: TEA_NOT_INSTALLED");
  });

  it("fails with AUTH_REQUIRED when tea has zero logins", async () => {
    const cwd = makeRepo("https://gitea.example.com/testowner/testrepo.git");
    const bin = makeSandbox({ logins: [] });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: AUTH_REQUIRED");
    expect(stdout).toContain("tea login add");
  });

  it("fails with REPO_NOT_FOUND when no login matches the remote hostname", async () => {
    const cwd = makeRepo("https://gitea.example.com/testowner/testrepo.git");
    const bin = makeSandbox({
      logins: [{ name: "other", url: "https://other.example.net", default: "true" }],
    });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(1);
    expect(stdout).toContain("code: REPO_NOT_FOUND");
    expect(stdout).toContain("gitea.example.com");
  });

  it("fails with VALIDATION_ERROR listing profiles on an ambiguous multi-match", async () => {
    const cwd = makeRepo("https://gitea.example.com/testowner/testrepo.git");
    const bin = makeSandbox({
      logins: [
        { name: "work", url: "https://gitea.example.com" },
        { name: "personal", url: "https://gitea.example.com" },
      ],
    });

    const { stdout, exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("work");
    expect(stdout).toContain("personal");
  });

  it("uses tea's default login when several match the hostname", async () => {
    const { url } = await startIssuesServer();
    const cwd = makeRepo(`${url}/testowner/testrepo.git`);
    const bin = makeSandbox({
      logins: [
        { name: "work", url },
        { name: "personal", url, default: "true" },
      ],
      token: "default-token",
    });

    const { exitCode } = await runCliTest(["issue", "list"], {
      env: { PATH: bin },
      cwd,
    });

    expect(exitCode).toBe(0);
    expect(server!.requests[0]!.headers.authorization).toBe("Bearer default-token");
  });

  it("fails with VALIDATION_ERROR listing available profiles for a nonexistent --login", async () => {
    const cwd = makeRepo("https://gitea.example.com/testowner/testrepo.git");
    const bin = makeSandbox({
      logins: [
        { name: "work", url: "https://gitea.example.com", default: "true" },
        { name: "personal", url: "https://gitea.example.com" },
      ],
    });

    const { stdout, exitCode } = await runCliTest(
      ["issue", "list", "--login", "missing"],
      { env: { PATH: bin }, cwd },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toContain("code: VALIDATION_ERROR");
    expect(stdout).toContain("missing");
    expect(stdout).toContain("available: work, personal");
  });

  it("selects a login by name with --login and adds it to suggestions", async () => {
    const { url } = await startIssuesServer();
    const cwd = makeRepo("https://unrelated.example.org/testowner/testrepo.git");
    const bin = makeSandbox({
      logins: [{ name: "fixture", url }],
      token: "named-token",
    });

    const { stdout, exitCode } = await runCliTest(
      ["--login", "fixture", "issue", "list"],
      { env: { PATH: bin }, cwd },
    );

    expect(exitCode).toBe(0);
    expect(server!.requests[0]!.headers.authorization).toBe("Bearer named-token");
    expect(stdout).toContain("--login fixture");
  });
});
