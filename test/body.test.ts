import { describe, expect, it } from "vitest";
import {
  BODY_TRUNCATE_LIMIT,
  cleanBody,
  truncateBody,
} from "../src/body.js";

const HOST = "gitea.example.com";

describe("truncateBody", () => {
  it("returns bodies at or under the limit untouched, without cleaning", () => {
    const body = `See https://${HOST}/o/r/issues/9 for details`;
    expect(truncateBody(body, BODY_TRUNCATE_LIMIT, HOST)).toBe(body);
  });

  it("returns a body exactly at the limit untouched", () => {
    const body = "x".repeat(BODY_TRUNCATE_LIMIT);
    expect(truncateBody(body, BODY_TRUNCATE_LIMIT, HOST)).toBe(body);
  });

  it("truncates an over-limit body with the inline hint and original length", () => {
    const body = "y".repeat(BODY_TRUNCATE_LIMIT + 250);
    const out = truncateBody(body, BODY_TRUNCATE_LIMIT, HOST);
    expect(out.startsWith("y".repeat(BODY_TRUNCATE_LIMIT))).toBe(true);
    expect(out).toContain(
      `... (truncated, ${BODY_TRUNCATE_LIMIT + 250} chars total - use --full to see complete body)`,
    );
  });

  it("returns the cleaned body with a note when cleaning brings it under the limit", () => {
    const longUrl = `https://${HOST}/${"segment/".repeat(20)}deep/path/resource`;
    const filler = "z".repeat(BODY_TRUNCATE_LIMIT - 20);
    const body = `${filler} ${longUrl}`;
    expect(body.length).toBeGreaterThan(BODY_TRUNCATE_LIMIT);
    const out = truncateBody(body, BODY_TRUNCATE_LIMIT, HOST);
    expect(out).toContain("[long URL removed]");
    expect(out).toContain(`(cleaned, ${body.length} chars original - use --full to see original)`);
    expect(out).not.toContain("truncated,");
  });
});

describe("cleanBody", () => {
  it("normalizes bare issue and PR URLs on the detected host", () => {
    const text = `Fixed by https://${HOST}/acme/widgets/pulls/12, closes https://${HOST}/acme/widgets/issues/7`;
    const out = cleanBody(text, HOST);
    expect(out).toContain("PR#12");
    expect(out).toContain("Issue#7");
    expect(out).not.toContain(HOST);
  });

  it("normalizes issue URLs carrying a fragment", () => {
    const out = cleanBody(`see https://${HOST}/o/r/issues/33#issuecomment-9 ok`, HOST);
    expect(out).toContain("Issue#33");
    expect(out).not.toContain("issuecomment");
  });

  it("normalizes issue/PR URLs inside markdown links", () => {
    const out = cleanBody(`[the fix](https://${HOST}/o/r/pulls/5)`, HOST);
    expect(out).toContain("PR#5");
    expect(out).not.toContain("the fix");
  });

  it("leaves URLs on a different host alone", () => {
    const text = `https://other.host/o/r/issues/7`;
    expect(cleanBody(text, HOST)).toBe(text);
  });

  it("strips markdown image embeds, keeping alt text when present", () => {
    expect(cleanBody("![a diagram](https://x/y.png)", HOST)).toContain("[image: a diagram]");
    expect(cleanBody("![](https://x/y.png)", HOST)).toContain("[image]");
  });

  it("drops the URL from a markdown link when the URL is very long", () => {
    const longUrl = `https://cdn.example.com/${"a".repeat(90)}`;
    const out = cleanBody(`[report](${longUrl})`, HOST);
    expect(out).toBe("[report]");
  });

  it("removes standalone long URLs over 100 chars", () => {
    const longUrl = `https://cdn.example.com/${"b".repeat(110)}`;
    expect(cleanBody(`prefix ${longUrl} suffix`, HOST)).toBe("prefix [long URL removed] suffix");
  });

  it("collapses email-style quoted blocks of three or more lines", () => {
    const text = "reply\n> one\n> two\n> three\nend";
    const out = cleanBody(text, HOST);
    expect(out).toContain("[quoted text removed]");
    expect(out).not.toContain("> two");
  });

  it("leaves a short (two-line) quoted block intact", () => {
    const text = "> one\n> two\nafter";
    const out = cleanBody(text, HOST);
    expect(out).toContain("> one");
    expect(out).not.toContain("[quoted text removed]");
  });
});
