import type { CombinedStatus, CommitStatus } from "gitea-js";
import type { GiteaClient } from "./client.js";
import type { RepoContext } from "./context.js";
import { classifyHttpError } from "./errors.js";

/**
 * A PR's CI checks, derived from its commit statuses. Shared by `pr view` (which
 * renders only the {@link ChecksResult.summary} line) and `pr checks` (which
 * renders the summary plus the per-check rows).
 */

/** gh-axi's four-value check classification (see the gitea-axi spec, "pr checks"). */
export type CheckConclusion = "pass" | "fail" | "skip" | "pending";

/** The summary shown when a PR has no commit statuses at all. */
export const NO_CHECKS_MESSAGE =
  "0 passed, 0 failed — this PR has no CI checks configured";

export interface CheckRow {
  name: string;
  conclusion: CheckConclusion;
}

export interface ChecksResult {
  /** The `N passed, N failed[, N skipped][, N pending], N total` line, or {@link NO_CHECKS_MESSAGE}. */
  summary: string;
  checks: CheckRow[];
}

/**
 * Map a Gitea commit-status state to a check conclusion. `warning` counts as a
 * failure, matching Gitea's own status-combine logic; `skipped` (only emitted by
 * newer instances) is its own bucket. Anything else — `pending` and any state a
 * future Gitea might add — is treated as still-in-progress rather than reported
 * as a pass or a failure it is not.
 */
function classifyState(state: string | undefined): CheckConclusion {
  switch (state) {
    case "success":
      return "pass";
    case "failure":
    case "error":
    case "warning":
      return "fail";
    case "skipped":
      return "skip";
    default:
      return "pending";
  }
}

/**
 * Reduce a PR's commit statuses to its checks summary and per-check rows. The
 * `skipped` and `pending` counts are folded into the summary line only when
 * non-zero, so an all-passing PR reads `N passed, 0 failed, N total`.
 */
export function summarizeChecks(statuses: CommitStatus[]): ChecksResult {
  const checks: CheckRow[] = statuses.map((status) => ({
    name: status.context ?? "",
    conclusion: classifyState(status.status),
  }));
  return { summary: summaryLine(checks), checks };
}

function summaryLine(checks: CheckRow[]): string {
  if (checks.length === 0) {
    return NO_CHECKS_MESSAGE;
  }
  const count = (conclusion: CheckConclusion): number =>
    checks.filter((check) => check.conclusion === conclusion).length;
  const parts = [`${count("pass")} passed`, `${count("fail")} failed`];
  const skipped = count("skip");
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  const pending = count("pending");
  if (pending > 0) {
    parts.push(`${pending} pending`);
  }
  parts.push(`${checks.length} total`);
  return parts.join(", ");
}

/**
 * Fetch a PR head SHA's combined commit status and reduce it to its checks
 * summary and rows. One HTTP call — `pr view` issues it once the head SHA is
 * known, after the PR and reviews fetches (ADR 0006's three-call pattern).
 */
export async function fetchChecks(
  api: GiteaClient,
  context: RepoContext,
  sha: string,
): Promise<ChecksResult> {
  let combined: CombinedStatus;
  try {
    const response = await api.repos.repoGetCombinedStatusByRef(context.owner, context.name, sha);
    combined = response.data;
  } catch (error) {
    throw classifyHttpError(error);
  }
  return summarizeChecks(combined.statuses ?? []);
}
