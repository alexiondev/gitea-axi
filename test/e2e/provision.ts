/**
 * Provisioning for the end-to-end tier: bring a fresh, disposable Gitea instance
 * to a usable state entirely over its HTTP API, with no `docker exec` or shell
 * access to the container. Everything here runs identically on Gitea Actions,
 * GitHub Actions, and a developer's local `docker run gitea/gitea`.
 *
 * Bootstrap chain:
 *   1. Wait for the instance to answer `GET /api/v1/version`.
 *   2. Register the first user through the web sign-up form — Gitea makes the
 *      first registered account the site administrator.
 *   3. Mint a scoped API token for that user via HTTP Basic auth (no CSRF).
 *   4. Create a repository and seed issues with that token.
 */

export interface E2EInstance {
  /** Instance base URL, without the /api/v1 suffix (what the CLI expects). */
  baseUrl: string;
  owner: string;
  repo: string;
  token: string;
  /** Titles of the seeded open issues, in creation order (newest number last). */
  openTitles: string[];
  /** Title of the single seeded closed issue. */
  closedTitle: string;
}

const USERNAME = "e2e-admin";
const PASSWORD = "e2e-admin-password-123";
const EMAIL = "e2e-admin@example.com";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGitea(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/version`);
      if (res.ok) {
        return;
      }
      lastError = new Error(`GET /api/v1/version returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Gitea at ${baseUrl} never became ready: ${String(lastError)}`);
}

/** A minimal cookie jar: keep the latest value per cookie name. */
function collectCookies(jar: Map<string, string>, res: Response): void {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0]!;
    const eq = pair.indexOf("=");
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Register the first account through the web sign-up form. Gitea protects the
 * form with a double-submit CSRF token that must be scraped from the rendered
 * HTML and echoed back alongside the matching cookie. Best-effort: a fresh
 * instance succeeds here, and {@link mintToken} is the real gate on success (a
 * pre-existing account from a local re-run is tolerated).
 */
async function registerFirstUser(baseUrl: string): Promise<void> {
  const jar = new Map<string, string>();
  const getRes = await fetch(`${baseUrl}/user/sign_up`);
  collectCookies(jar, getRes);
  const html = await getRes.text();
  const csrf = html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  if (!csrf) {
    throw new Error("Could not find a CSRF token on the Gitea sign-up page");
  }
  const form = new URLSearchParams({
    _csrf: csrf,
    user_name: USERNAME,
    email: EMAIL,
    password: PASSWORD,
    retype: PASSWORD,
  });
  await fetch(`${baseUrl}/user/sign_up`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar),
    },
    body: form.toString(),
    redirect: "manual",
  });
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
}

async function mintToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/users/${USERNAME}/tokens`, {
    method: "POST",
    headers: {
      authorization: basicAuth(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // write:user is what Gitea requires to create a repo under the user
      // (POST /user/repos); write:repository/write:issue cover the repo + issue
      // reads and writes the provisioning and CLI seam then perform.
      name: `e2e-${Date.now()}`,
      scopes: ["write:user", "write:repository", "write:issue"],
    }),
  });
  if (res.status !== 201) {
    throw new Error(
      `Token creation failed (${res.status}); first-user registration likely did not take. Body: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { sha1?: string };
  if (!body.sha1) {
    throw new Error("Token response had no sha1 field");
  }
  return body.sha1;
}

/**
 * One authenticated Gitea API round-trip: attach the token, send an optional
 * JSON body, and fail on any non-2xx. Returns the raw {@link Response} so callers
 * can read the body or headers (e.g. the x-total-count the count line uses).
 */
async function apiRequest(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  payload?: unknown,
): Promise<Response> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `token ${token}`,
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res;
}

export async function provisionInstance(baseUrl: string): Promise<E2EInstance> {
  const normalized = baseUrl.replace(/\/+$/, "");
  await waitForGitea(normalized);
  await registerFirstUser(normalized);
  const token = await mintToken(normalized);

  const repo = `e2e-repo-${Date.now()}`;
  await apiRequest(normalized, "POST", "/user/repos", token, {
    name: repo,
    auto_init: true,
    default_branch: "main",
    private: false,
  });

  const openTitles = ["E2E first issue", "E2E second issue", "E2E third issue"];
  for (const title of openTitles) {
    await apiRequest(normalized, "POST", `/repos/${USERNAME}/${repo}/issues`, token, {
      title,
      body: `Seeded body for ${title}.`,
    });
  }

  const closedTitle = "E2E closed issue";
  const closedRes = await apiRequest(normalized, "POST", `/repos/${USERNAME}/${repo}/issues`, token, {
    title: closedTitle,
    body: "Seeded closed issue.",
  });
  const closed = (await closedRes.json()) as { number: number };
  await apiRequest(normalized, "PATCH", `/repos/${USERNAME}/${repo}/issues/${closed.number}`, token, {
    state: "closed",
  });

  return { baseUrl: normalized, owner: USERNAME, repo, token, openTitles, closedTitle };
}

/**
 * The response-shape paths the issue-list command's FieldDef extractors read
 * (see ISSUE_LIST_FIELDS in src/commands/issue.ts). This one contract anchors
 * three things that must agree: the extractors, the recorded fixtures, and the
 * live Gitea response. The end-to-end shape guard asserts both the fixture and
 * the live payload satisfy it, so a divergence in either fails the tier.
 */
export const COVERED_ISSUE_PATHS = ["number", "title", "state", "created_at", "user.login"];

/** Whether `obj` has a defined value at a dotted `path` (e.g. "user.login"). */
export function hasPath(obj: unknown, path: string): boolean {
  let value: unknown = obj;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value !== undefined && value !== null;
}

/**
 * Fetch the raw issues-list response the CLI's issue-list command consumes, for
 * the response-shape guard. Returns both the parsed array and the header the
 * count line is built from.
 */
export async function fetchRawIssues(
  instance: E2EInstance,
  state: "open" | "closed" | "all",
): Promise<{ issues: Record<string, unknown>[]; totalCount: string | null }> {
  const res = await apiRequest(
    instance.baseUrl,
    "GET",
    `/repos/${instance.owner}/${instance.repo}/issues?type=issues&state=${state}&limit=30&page=1`,
    instance.token,
  );
  return {
    issues: (await res.json()) as Record<string, unknown>[],
    totalCount: res.headers.get("x-total-count"),
  };
}
