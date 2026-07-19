import type { CliDeps } from "./deps.js";
import { axiError } from "./errors.js";
import { detectRemote } from "./git.js";
import { getToken, listLogins, type TeaLogin } from "./tea.js";

export type ContextSource = "flag" | "env" | "auto";

export interface RepoContext {
  owner: string;
  name: string;
  host: string;
  /** Gitea instance base URL, without the /api/v1 suffix. */
  apiUrl: string;
  token: string;
  repoSource: ContextSource;
  loginSource: ContextSource;
  loginName?: string;
}

/** The repo/login overrides resolved from flags and environment, pre-context. */
interface ContextOverrides {
  repoSpec?: string;
  repoSource: ContextSource;
  /** Human label for where the repo spec came from, for error messages. */
  repoOrigin: string;
  loginName?: string;
  loginSource: ContextSource;
}

function resolveOverrides(deps: CliDeps): ContextOverrides {
  const repoFromFlag = deps.globals.repo;
  const repoFromEnv = deps.env.GITEA_AXI_REPO;
  const loginFromFlag = deps.globals.login;
  const loginFromEnv = deps.env.GITEA_AXI_LOGIN;
  return {
    repoSpec: repoFromFlag ?? repoFromEnv,
    repoSource: repoFromFlag ? "flag" : repoFromEnv ? "env" : "auto",
    repoOrigin: repoFromFlag ? "`-R`" : "`GITEA_AXI_REPO`",
    loginName: loginFromFlag ?? loginFromEnv,
    loginSource: loginFromFlag ? "flag" : loginFromEnv ? "env" : "auto",
  };
}

function parseRepoSpec(spec: string, origin: string): { owner: string; name: string } {
  const segments = spec.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw axiError(
      `Invalid repository "${spec}" from ${origin}: expected OWNER/NAME`,
      "VALIDATION_ERROR",
    );
  }
  return { owner: segments[0], name: segments[1] };
}

function hostnameOf(url: string, origin: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw axiError(`Invalid URL "${url}" from ${origin}`, "VALIDATION_ERROR");
  }
}

/**
 * Normalize a Gitea base URL to the host root the client expects. The client
 * (gitea-js) appends `/api/v1` itself, so a value that already carries it — a
 * natural guess when the variable is literally named `..._API_URL` — would double
 * the segment and 404 as a spurious `REPO_NOT_FOUND`. Strip a trailing `/api/v1`
 * (with any trailing slashes) so the host base and the API endpoint both work.
 */
function normalizeApiBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

function resolveTestModeContext(
  deps: CliDeps,
  apiUrl: string,
  overrides: ContextOverrides,
): RepoContext {
  if (!overrides.repoSpec) {
    throw axiError(
      "Repository context is required when GITEA_AXI_API_URL is set",
      "REPO_NOT_FOUND",
      ["Set `GITEA_AXI_REPO=OWNER/NAME` or pass `-R OWNER/NAME`"],
    );
  }
  const base = normalizeApiBase(apiUrl);
  return {
    ...parseRepoSpec(overrides.repoSpec, overrides.repoOrigin),
    host: hostnameOf(base, "`GITEA_AXI_API_URL`"),
    apiUrl: base,
    token: deps.env.GITEA_AXI_TOKEN ?? "",
    repoSource: overrides.repoSource,
    loginSource: overrides.loginSource,
    loginName: overrides.loginName,
  };
}

function matchLoginsByHost(logins: TeaLogin[], host: string): TeaLogin[] {
  return logins.filter((login) => {
    if (login.sshHost && login.sshHost === host) {
      return true;
    }
    try {
      return new URL(login.url).hostname === host;
    } catch {
      return false;
    }
  });
}

export function selectLogin(
  logins: TeaLogin[],
  loginName: string | undefined,
  remoteHost: string | undefined,
): TeaLogin {
  if (logins.length === 0) {
    throw axiError("No tea logins are configured", "AUTH_REQUIRED", [
      "Run `tea login add` to configure a login",
    ]);
  }
  if (loginName) {
    const login = logins.find((entry) => entry.name === loginName);
    if (!login) {
      throw axiError(
        `Login profile "${loginName}" not found (available: ${logins.map((l) => l.name).join(", ")})`,
        "VALIDATION_ERROR",
        ["Pass `--login <name>` with one of the listed profiles"],
      );
    }
    return login;
  }
  if (!remoteHost) {
    throw axiError(
      "Cannot select a tea login without a git remote hostname",
      "REPO_NOT_FOUND",
      ["Pass `--login <name>` together with `-R OWNER/NAME`"],
    );
  }
  const matches = matchLoginsByHost(logins, remoteHost);
  if (matches.length === 0) {
    throw axiError(
      `No tea login matches host "${remoteHost}" — this may not be a Gitea repository`,
      "REPO_NOT_FOUND",
      [
        `Run \`tea login add --url ${remoteHost}\` if this is a Gitea instance`,
        "Or pass `-R OWNER/NAME` together with `--login <name>`",
      ],
    );
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const fallback = matches.find((login) => login.isDefault);
  if (fallback) {
    return fallback;
  }
  throw axiError(
    `Multiple tea logins match host "${remoteHost}": ${matches.map((l) => l.name).join(", ")}`,
    "VALIDATION_ERROR",
    ["Pass `--login <name>` to select one"],
  );
}

export async function resolveRepoContext(deps: CliDeps): Promise<RepoContext> {
  const overrides = resolveOverrides(deps);

  const testApiUrl = deps.env.GITEA_AXI_API_URL;
  if (testApiUrl) {
    return resolveTestModeContext(deps, testApiUrl, overrides);
  }

  const remote = await detectRemote(deps);
  let owner: string;
  let name: string;
  if (overrides.repoSpec) {
    ({ owner, name } = parseRepoSpec(overrides.repoSpec, overrides.repoOrigin));
  } else if (remote) {
    ({ owner, name } = remote);
  } else {
    throw axiError(
      "Could not detect a Gitea repository from the git `origin` remote",
      "REPO_NOT_FOUND",
      [
        "Run inside a git repository whose `origin` remote points at a Gitea instance",
        "Or pass `-R OWNER/NAME` together with `--login <name>`",
      ],
    );
  }

  const logins = await listLogins(deps);
  const login = selectLogin(logins, overrides.loginName, remote?.host);
  const host = hostnameOf(login.url, `tea login "${login.name}"`);
  const token = await getToken(deps, login, host);

  return {
    owner,
    name,
    host,
    apiUrl: normalizeApiBase(login.url),
    token,
    repoSource: overrides.repoSource,
    loginSource: overrides.loginSource,
    loginName: login.name,
  };
}
