import { AxiError } from "axi-sdk-js";
import { describe, expect, it } from "vitest";
import { classifyHttpError } from "../src/errors.js";

/**
 * Unit-tier coverage of the HTTP error classifier (a pure function, no I/O).
 * The integration tier drives the classifier through the issue-list seam, but
 * some branches belong to paths no shipped command reaches yet — pull-request
 * 404s, the already-classified passthrough, and non-HTTP transport failures —
 * so they are exercised directly here against crafted inputs.
 */
function httpError(status: number, url: string, body?: unknown) {
  return { status, url, error: body };
}

const REPO = "http://gitea.example/api/v1/repos/o/r";

describe("classifyHttpError", () => {
  it("passes an already-classified AxiError through unchanged", () => {
    const original = new AxiError("boom", "FORBIDDEN", ["hint"]);
    expect(classifyHttpError(original)).toBe(original);
  });

  it("classifies a 404 on an issue path as ISSUE_NOT_FOUND", () => {
    const result = classifyHttpError(httpError(404, `${REPO}/issues/42`));
    expect(result.code).toBe("ISSUE_NOT_FOUND");
    expect(result.message).toContain("#42");
  });

  it("classifies a 404 on a pull path as PR_NOT_FOUND", () => {
    const result = classifyHttpError(httpError(404, `${REPO}/pulls/7`));
    expect(result.code).toBe("PR_NOT_FOUND");
    expect(result.message).toContain("#7");
  });

  it("classifies a 404 on the repo subtree as REPO_NOT_FOUND", () => {
    const result = classifyHttpError(httpError(404, `${REPO}/issues`));
    expect(result.code).toBe("REPO_NOT_FOUND");
    expect(result.message).toContain("o/r");
  });

  it("classifies a 404 on a non-repo path as UNKNOWN", () => {
    const result = classifyHttpError(httpError(404, "http://gitea.example/api/v1/version"));
    expect(result.code).toBe("UNKNOWN");
  });

  it("falls back to the raw url when the response url does not parse", () => {
    const result = classifyHttpError(httpError(404, "::not a url::"));
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toContain("::not a url::");
  });

  it("uses the body message when present, and a default when absent", () => {
    expect(classifyHttpError(httpError(401, REPO, { message: "token expired" })).message).toBe(
      "token expired",
    );
    expect(classifyHttpError(httpError(401, REPO, {})).message).toBe("Authentication required");
  });

  it("maps 403 and every validation status (405/409/422) and 429 to their codes", () => {
    expect(classifyHttpError(httpError(403, REPO, {})).code).toBe("FORBIDDEN");
    expect(classifyHttpError(httpError(405, REPO, {})).code).toBe("VALIDATION_ERROR");
    expect(classifyHttpError(httpError(409, REPO, {})).code).toBe("VALIDATION_ERROR");
    expect(classifyHttpError(httpError(422, REPO, {})).code).toBe("VALIDATION_ERROR");
    expect(classifyHttpError(httpError(429, REPO, {})).code).toBe("RATE_LIMITED");
  });

  it("maps an unexpected status to UNKNOWN, with and without a body message", () => {
    expect(classifyHttpError(httpError(500, REPO, { message: "kaboom" })).message).toContain(
      "kaboom",
    );
    const bare = classifyHttpError(httpError(503, REPO, {}));
    expect(bare.code).toBe("UNKNOWN");
    expect(bare.message).toContain("503");
  });

  it("classifies a plain Error transport failure as UNKNOWN", () => {
    const result = classifyHttpError(new Error("network down"));
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toContain("network down");
  });

  it("includes the underlying cause when a transport failure carries one", () => {
    const error = new Error("fetch failed", { cause: new Error("ECONNREFUSED") });
    const result = classifyHttpError(error);
    expect(result.message).toContain("fetch failed");
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("stringifies a non-Error thrown value", () => {
    const result = classifyHttpError("just a string");
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toContain("just a string");
  });
});
