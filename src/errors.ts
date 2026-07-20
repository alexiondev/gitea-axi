import { AxiError } from "axi-sdk-js";

export type AxiErrorCode =
  | "REPO_NOT_FOUND"
  | "ISSUE_NOT_FOUND"
  | "PR_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TEA_NOT_INSTALLED"
  | "VALIDATION_ERROR"
  | "GIT_ERROR"
  | "TARGET_NOT_WRITABLE"
  | "UNKNOWN";

export function axiError(
  message: string,
  code: AxiErrorCode,
  suggestions: string[] = [],
): AxiError {
  return new AxiError(message, code, suggestions);
}

// The three ways a filesystem refuses a write for reasons the user must settle
// outside this tool: the permission bits deny it, the file is flagged immutable
// or otherwise protected, or the filesystem itself is mounted read-only.
const NOT_WRITABLE_ERRNOS = ["EACCES", "EPERM", "EROFS"];

/** Whether a caught filesystem error means the target cannot be written. */
export function isNotWritableError(error: unknown): boolean {
  const errno = (error as { code?: unknown } | null)?.code;
  return typeof errno === "string" && NOT_WRITABLE_ERRNOS.includes(errno);
}

/**
 * The same judgement made from an error's *message*, for a caller handed the
 * formatted text rather than the error object.
 *
 * This takes the message alone, never a string the target's path has been
 * spliced into: a path is the user's to name, and one that happened to contain
 * `EACCES` would otherwise misreport an unrelated failure as a read-only target.
 */
export function isNotWritableMessage(message: string): boolean {
  return NOT_WRITABLE_ERRNOS.some((errno) => message.includes(errno));
}

/**
 * A read-only target reported as something the user can act on.
 *
 * The remedy is deliberately general. Read-only is not diagnostic of any
 * particular configuration manager, and every plausible cause — a declarative
 * home manager, an immutable flag, a root-owned path — has the same answer:
 * whatever renders the file read-only is where this belongs, not here.
 *
 * `subject` names what the caller was installing, for the remedy line.
 */
export function unwritableTargetError(path: string, subject: string): AxiError {
  return axiError(
    `Cannot write ${path}: it is not writable, so it appears to be managed by another tool`,
    "TARGET_NOT_WRITABLE",
    [
      `Declare ${subject} through that tool's configuration rather than installing it with this command`,
      `Or make ${path} writable and re-run`,
    ],
  );
}

interface HttpResponseLike {
  status: number;
  url: string;
  error: unknown;
}

function isHttpResponseLike(value: unknown): value is HttpResponseLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HttpResponseLike).status === "number" &&
    typeof (value as HttpResponseLike).url === "string"
  );
}

function bodyMessage(response: HttpResponseLike): string | undefined {
  const error = response.error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return undefined;
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const ISSUE_PATH = /\/repos\/[^/]+\/[^/]+\/issues\/(\d+)(?:\/|$)/;
// The trailing `.` case covers the `.diff`/`.patch` download paths, whose PR
// number is followed by a suffix rather than a `/` or the end of the path.
const PULL_PATH = /\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)(?:[./]|$)/;
const REPO_PATH = /\/repos\/([^/]+)\/([^/]+)(?:\/|$)/;

function classify404(response: HttpResponseLike): AxiError {
  const path = pathname(response.url);
  const issue = ISSUE_PATH.exec(path);
  if (issue) {
    return axiError(`Issue #${issue[1]} not found`, "ISSUE_NOT_FOUND", [
      "Run `gitea-axi issue list` to see existing issues",
    ]);
  }
  const pull = PULL_PATH.exec(path);
  if (pull) {
    return axiError(`Pull request #${pull[1]} not found`, "PR_NOT_FOUND");
  }
  // Gitea returns 404 for every path under a nonexistent repository, so any
  // repo-subtree 404 that is not an indexed issue/pull lookup means the
  // repository itself was not found.
  const repo = REPO_PATH.exec(path);
  if (repo) {
    return axiError(
      `Repository ${repo[1]}/${repo[2]} not found`,
      "REPO_NOT_FOUND",
      [
        "Check the repository owner and name",
        "Pass `-R OWNER/NAME` to target a different repository",
      ],
    );
  }
  return axiError(`Not found: ${path}`, "UNKNOWN");
}

/**
 * The HTTP status of a failed API call, or undefined if the failure was not an
 * HTTP response at all. For the callers that give one status a meaning of their
 * own before falling back to {@link classifyHttpError} — a 404 from Gitea's
 * by-base-head pull lookup, for instance, means "no such pull request exists",
 * which is an ordinary answer rather than an error.
 */
export function httpStatus(error: unknown): number | undefined {
  return isHttpResponseLike(error) ? error.status : undefined;
}

export function classifyHttpError(error: unknown): AxiError {
  if (error instanceof AxiError) {
    return error;
  }
  if (!isHttpResponseLike(error)) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` (${error.cause.message})`
        : "";
    return axiError(`Request failed: ${message}${cause}`, "UNKNOWN");
  }
  const detail = bodyMessage(error);
  switch (error.status) {
    case 401:
      return axiError(detail ?? "Authentication required", "AUTH_REQUIRED", [
        "Run `tea login add` to configure credentials, or verify the token is still valid",
      ]);
    case 403:
      return axiError(detail ?? "Access forbidden", "FORBIDDEN", [
        "Verify the token has permission to access this repository",
      ]);
    case 404:
      return classify404(error);
    case 405:
    case 409:
    case 422:
      return axiError(
        detail ?? `Validation failed (HTTP ${error.status})`,
        "VALIDATION_ERROR",
      );
    case 429:
      return axiError(detail ?? "Rate limited", "RATE_LIMITED", [
        "Wait and retry, or reduce `--limit` to make smaller requests",
      ]);
    default:
      return axiError(
        detail
          ? `Gitea API error (HTTP ${error.status}): ${detail}`
          : `Gitea API error (HTTP ${error.status})`,
        "UNKNOWN",
      );
  }
}
