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
  | "UNKNOWN";

export function axiError(
  message: string,
  code: AxiErrorCode,
  suggestions: string[] = [],
): AxiError {
  return new AxiError(message, code, suggestions);
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
const PULL_PATH = /\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)(?:\/|$)/;
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
