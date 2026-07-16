// Seed provisioning: bring a freshly provisioned throwaway repository to the
// deterministic ground truth of SEED_PLAN, scripted entirely over the Gitea API
// against the live host. This is the imperative boundary the seed-plan realizes;
// its value is the real API interaction, so it is validated by a smoke run
// (seed.smoke.test.ts) rather than mocked unit tests — see the benchmark-harness
// spec's testing decisions.
//
// Authentication reuses gitea-axi's own credential discovery (the tea login store
// and its git-credential token helper) rather than introducing new secret
// handling: resolveBenchAccess is a thin adapter over src/tea.ts and the login
// selection in src/context.ts.
//
// Every step is idempotent, keyed by a natural identity — a label by name, an
// issue or pull request by title, a comment or review by body, a branch by name —
// so re-running the seed against an already-seeded repository reconciles to the
// same ground truth instead of duplicating it.

import type { CliDeps } from "../src/deps.js";
import { selectLogin } from "../src/context.js";
import { getToken, listLogins } from "../src/tea.js";
import { groundTruth, SEED_PLAN, type SeedIssue, type SeedPullRequest } from "./seed-plan.js";
import type { RepoState, ReviewKind } from "./scoring-spec.js";

/** The live host coordinates a seeding run authenticates and talks to. */
export interface BenchAccess {
  /** Gitea instance base URL, without the /api/v1 suffix. */
  apiUrl: string;
  token: string;
}

/** Owner and name of a throwaway repository on the host. */
export interface RepoCoords {
  owner: string;
  repo: string;
}

/**
 * Resolve the host and token for a benchmark run by reusing gitea-axi's own
 * credential discovery: list the tea logins, pick the named one exactly as the
 * CLI does, and mint the token through tea's git-credential helper. No new secret
 * handling is introduced — the benchmark rides the same path the product ships.
 */
export async function resolveBenchAccess(deps: CliDeps, loginName: string): Promise<BenchAccess> {
  const logins = await listLogins(deps);
  const login = selectLogin(logins, loginName, undefined);
  const host = new URL(login.url).hostname;
  const token = await getToken(deps, login, host);
  return { apiUrl: login.url.replace(/\/+$/, ""), token };
}

/**
 * One authenticated Gitea API round-trip; returns the raw response unchecked.
 * Exported so the self-review probe (self-review.ts) can inspect a non-2xx
 * response — a host that forbids self-approval — without it being thrown.
 */
export async function request(
  access: BenchAccess,
  method: string,
  path: string,
  payload?: unknown,
): Promise<Response> {
  return fetch(`${access.apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `token ${access.token}`,
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

/** Fail on any non-2xx response, surfacing the method, path, status, and body. */
async function requireOk(res: Response, method: string, path: string): Promise<Response> {
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res;
}

/**
 * Issue a request and require a 2xx, returning the parsed JSON body. Exported so
 * the post-run snapshot capture (snapshot.ts) reads the live repository through
 * the same authenticated round-trip the seed writes through.
 */
export async function send<T>(
  access: BenchAccess,
  method: string,
  path: string,
  payload?: unknown,
): Promise<T> {
  const res = await requireOk(await request(access, method, path, payload), method, path);
  return (await res.json()) as T;
}

/** The single available user: the account the token authenticates as. */
export async function currentUser(access: BenchAccess): Promise<string> {
  const me = await send<{ login: string }>(access, "GET", "/user");
  return me.login;
}

/**
 * Create a fresh, private, auto-initialized throwaway repository under the
 * authenticated user and return its coordinates. Each call mints a distinct name,
 * so trials never collide.
 */
export async function provisionRepo(
  access: BenchAccess,
  name = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<RepoCoords> {
  const owner = await currentUser(access);
  await send(access, "POST", "/user/repos", {
    name,
    auto_init: true,
    default_branch: "main",
    private: true,
  });
  return { owner, repo: name };
}

/**
 * Best-effort deletion of a throwaway repository. `request` does not throw on a
 * non-2xx, so a token lacking delete scope is ignored silently; the try/catch
 * additionally tolerates a network-level failure. Cleanup must never fail a run.
 */
export async function deleteRepo(access: BenchAccess, coords: RepoCoords): Promise<void> {
  try {
    await request(access, "DELETE", `/repos/${coords.owner}/${coords.repo}`);
  } catch {
    // Swallow network-level failures; a non-2xx never reaches here.
  }
}

/** Colours compare equal regardless of a leading `#` or letter case. */
function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

interface GiteaLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

/**
 * Reconcile the repository's labels to the plan, keyed by name: create a missing
 * label, patch one whose colour or description drifted, and leave a matching one
 * untouched. Returns the name→id map the issue and pull-request steps need to
 * apply labels.
 */
async function ensureLabels(access: BenchAccess, coords: RepoCoords): Promise<Map<string, number>> {
  const base = `/repos/${coords.owner}/${coords.repo}/labels`;
  const existing = await send<GiteaLabel[]>(access, "GET", `${base}?limit=100`);
  const byName = new Map(existing.map((label) => [label.name, label]));
  for (const label of SEED_PLAN.labels) {
    const found = byName.get(label.name);
    if (!found) {
      const created = await send<GiteaLabel>(access, "POST", base, {
        name: label.name,
        color: label.color,
        description: label.description ?? "",
      });
      byName.set(created.name, created);
    } else if (
      normalizeColor(found.color) !== normalizeColor(label.color) ||
      (found.description ?? "") !== (label.description ?? "")
    ) {
      await send<GiteaLabel>(access, "PATCH", `${base}/${found.id}`, {
        color: label.color,
        description: label.description ?? "",
      });
    }
  }
  return new Map([...byName].map(([name, label]) => [name, label.id]));
}

/** Replace an issue-or-pull-request's applied labels with exactly the given ids. */
async function applyLabels(
  access: BenchAccess,
  coords: RepoCoords,
  number: number,
  names: string[],
  labelIds: Map<string, number>,
): Promise<void> {
  const ids = names.map((name) => labelIds.get(name)).filter((id): id is number => id !== undefined);
  await send(access, "PUT", `/repos/${coords.owner}/${coords.repo}/issues/${number}/labels`, {
    labels: ids,
  });
}

/**
 * Add each item whose body is not already present at `base`, keyed by body. Both
 * comments and reviews live at a single endpoint that lists and creates at the
 * same path, so one reconciler serves them: it lists what is there, then posts
 * only the items whose body is missing — which is what makes re-seeding a no-op.
 */
async function addMissingByBody<T>(
  access: BenchAccess,
  base: string,
  items: T[],
  bodyOf: (item: T) => string,
  payloadOf: (item: T) => unknown,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const existing = await send<{ body: string }[]>(access, "GET", base);
  const present = new Set(existing.map((entry) => entry.body));
  for (const item of items) {
    if (!present.has(bodyOf(item))) {
      await send(access, "POST", base, payloadOf(item));
    }
  }
}

/** Add each comment body not already present on an issue or pull request. */
async function ensureComments(
  access: BenchAccess,
  coords: RepoCoords,
  number: number,
  bodies: string[],
): Promise<void> {
  await addMissingByBody(
    access,
    `/repos/${coords.owner}/${coords.repo}/issues/${number}/comments`,
    bodies,
    (body) => body,
    (body) => ({ body }),
  );
}

interface GiteaIssue {
  number: number;
  title: string;
}

/**
 * Reconcile one plan issue, keyed by title: create it if absent, then declare its
 * body, state, applied labels, and assignee presence (the single user or nobody)
 * and add any missing comments. Every field is set to the desired value, so the
 * step is idempotent whether the issue was just created or already seeded.
 */
async function ensureIssue(
  access: BenchAccess,
  coords: RepoCoords,
  user: string,
  issue: SeedIssue,
  labelIds: Map<string, number>,
  byTitle: Map<string, number>,
): Promise<void> {
  const base = `/repos/${coords.owner}/${coords.repo}/issues`;
  let number = byTitle.get(issue.title);
  if (number === undefined) {
    const created = await send<GiteaIssue>(access, "POST", base, {
      title: issue.title,
      body: issue.body,
    });
    number = created.number;
    byTitle.set(issue.title, number);
  }
  await send(access, "PATCH", `${base}/${number}`, {
    title: issue.title,
    body: issue.body,
    state: issue.state,
    assignees: issue.assignToSelf ? [user] : [],
  });
  await applyLabels(access, coords, number, issue.labels, labelIds);
  await ensureComments(access, coords, number, issue.comments);
}

/** The Gitea review event verb for each seed review kind. */
const REVIEW_EVENT: Record<ReviewKind, string> = {
  comment: "COMMENT",
  approved: "APPROVED",
  "request-changes": "REQUEST_CHANGES",
};

/** Ensure the pull request's feature branch exists, creating it with its file. */
async function ensureBranch(
  access: BenchAccess,
  coords: RepoCoords,
  pr: SeedPullRequest,
): Promise<void> {
  const branchPath = `/repos/${coords.owner}/${coords.repo}/branches/${pr.headBranch}`;
  const res = await request(access, "GET", branchPath);
  if (res.ok) {
    return;
  }
  if (res.status !== 404) {
    await requireOk(res, "GET", branchPath);
  }
  await send(access, "POST", `/repos/${coords.owner}/${coords.repo}/contents/${pr.filePath}`, {
    content: Buffer.from(pr.fileContent).toString("base64"),
    message: `Seed ${pr.headBranch}`,
    new_branch: pr.headBranch,
  });
}

/** Add each review (matched by body) not already present on the pull request. */
async function ensureReviews(
  access: BenchAccess,
  coords: RepoCoords,
  number: number,
  reviews: SeedPullRequest["reviews"],
): Promise<void> {
  await addMissingByBody(
    access,
    `/repos/${coords.owner}/${coords.repo}/pulls/${number}/reviews`,
    reviews,
    (review) => review.body,
    (review) => ({ event: REVIEW_EVENT[review.kind], body: review.body }),
  );
}

interface GiteaPull {
  number: number;
  title: string;
  state?: string;
  /** True once merged; a merged pull request cannot be reopened. */
  merged?: boolean;
}

/**
 * Reconcile one plan pull request, keyed by title: ensure its feature branch,
 * open the pull request if absent, then declare its labels and add any missing
 * comments and reviews. All content is authored by the single available user.
 */
async function ensurePullRequest(
  access: BenchAccess,
  coords: RepoCoords,
  pr: SeedPullRequest,
  labelIds: Map<string, number>,
  byTitle: Map<string, GiteaPull>,
): Promise<void> {
  await ensureBranch(access, coords, pr);
  const base = `/repos/${coords.owner}/${coords.repo}/pulls`;
  let number: number;
  const existing = byTitle.get(pr.title);
  if (existing === undefined) {
    const created = await send<GiteaPull>(access, "POST", base, {
      title: pr.title,
      body: pr.body,
      base: "main",
      head: pr.headBranch,
    });
    number = created.number;
    byTitle.set(pr.title, created);
  } else {
    number = existing.number;
    // The ground truth declares every seeded pull request open. Reopen one that
    // drifted closed (but never a merged one, which Gitea cannot reopen), so the
    // seed reconciles state as declaratively as it does for issues.
    if (existing.state === "closed" && existing.merged !== true) {
      await send(access, "PATCH", `${base}/${number}`, { state: "open" });
    }
  }
  await applyLabels(access, coords, number, pr.labels, labelIds);
  await ensureComments(access, coords, number, pr.comments);
  await ensureReviews(access, coords, number, pr.reviews);
}

/**
 * Seed a freshly provisioned repository to the ground truth, idempotently. Labels
 * come first (so issues and pull requests can apply them), then the issue spread,
 * then the pull requests. Returns the deterministic ground-truth RepoState the
 * checker scores against; on a fresh repository the created numbers match it,
 * and a re-run leaves them unchanged.
 */
export async function seedRepo(access: BenchAccess, coords: RepoCoords): Promise<RepoState> {
  const user = await currentUser(access);
  const labelIds = await ensureLabels(access, coords);

  const issuesPath = `/repos/${coords.owner}/${coords.repo}/issues?type=issues&state=all&limit=100`;
  const existingIssues = await send<GiteaIssue[]>(access, "GET", issuesPath);
  const issuesByTitle = new Map(existingIssues.map((issue) => [issue.title, issue.number]));
  for (const issue of SEED_PLAN.issues) {
    await ensureIssue(access, coords, user, issue, labelIds, issuesByTitle);
  }

  const pullsPath = `/repos/${coords.owner}/${coords.repo}/pulls?state=all&limit=100`;
  const existingPulls = await send<GiteaPull[]>(access, "GET", pullsPath);
  const pullsByTitle = new Map(existingPulls.map((pull) => [pull.title, pull]));
  for (const pr of SEED_PLAN.pullRequests) {
    await ensurePullRequest(access, coords, pr, labelIds, pullsByTitle);
  }

  return groundTruth(user);
}

/**
 * The observable facts the smoke run checks, read back from live Gitea (not from
 * the plan) so the assertion compares the real repository against the declared
 * ground truth rather than the plan against itself.
 */
export interface SeedSummary {
  labelNames: string[];
  openIssueTitles: string[];
  closedIssueTitles: string[];
  selfAssignedIssueCount: number;
  issuesWithCommentsCount: number;
  pullTitles: string[];
  labeledPullTitles: string[];
  reviewedPullTitles: string[];
}

interface GiteaIssueSummary {
  title: string;
  state: string;
  assignees: { login: string }[] | null;
  comments: number;
}

interface GiteaPullSummary {
  number: number;
  title: string;
  labels: { name: string }[] | null;
}

/** Read the live repository into the summary the smoke run asserts against. */
export async function readSeedSummary(
  access: BenchAccess,
  coords: RepoCoords,
): Promise<SeedSummary> {
  const repo = `/repos/${coords.owner}/${coords.repo}`;
  const labels = await send<GiteaLabel[]>(access, "GET", `${repo}/labels?limit=100`);
  const issues = await send<GiteaIssueSummary[]>(
    access,
    "GET",
    `${repo}/issues?type=issues&state=all&limit=100`,
  );
  const pulls = await send<GiteaPullSummary[]>(access, "GET", `${repo}/pulls?state=all&limit=100`);

  const reviewedPullTitles: string[] = [];
  for (const pull of pulls) {
    const reviews = await send<{ body: string }[]>(
      access,
      "GET",
      `${repo}/pulls/${pull.number}/reviews`,
    );
    if (reviews.length > 0) {
      reviewedPullTitles.push(pull.title);
    }
  }

  return {
    labelNames: labels.map((label) => label.name),
    openIssueTitles: issues.filter((i) => i.state === "open").map((i) => i.title),
    closedIssueTitles: issues.filter((i) => i.state === "closed").map((i) => i.title),
    selfAssignedIssueCount: issues.filter((i) => (i.assignees ?? []).length > 0).length,
    issuesWithCommentsCount: issues.filter((i) => i.comments > 0).length,
    pullTitles: pulls.map((p) => p.title),
    labeledPullTitles: pulls.filter((p) => (p.labels ?? []).length > 0).map((p) => p.title),
    reviewedPullTitles,
  };
}
