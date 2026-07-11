/**
 * Body cleaning and truncation, shared by every command that renders an issue,
 * pull request, or comment body. Cleaning is deliberately applied *only* when a
 * body exceeds its truncation limit, so short bodies pass through byte-for-byte
 * (see the gitea-axi spec, "Content truncation").
 */

export const BODY_TRUNCATE_LIMIT = 500;
export const COMMENT_TRUNCATE_LIMIT = 800;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The two Gitea URL path segments that carry a reference number. */
type RefKind = "issues" | "pulls";

function issueRef(kind: RefKind, number: string): string {
  return kind === "pulls" ? `PR#${number}` : `Issue#${number}`;
}

/**
 * Normalize Gitea issue/PR URLs on the given host, strip image embeds and long
 * URLs, and collapse email-style quoted blocks. Transforms run in a fixed order
 * so that later, coarser rules never consume text an earlier rule owns.
 */
export function cleanBody(text: string, host: string): string {
  const escapedHost = escapeForRegex(host);
  // owner/repo/(issues|pulls)/N, with an optional #fragment or ?query tail.
  const urlCore = `https?://${escapedHost}/[^/\\s)]+/[^/\\s)]+/(issues|pulls)/(\\d+)`;

  let result = text;

  // 1. Gitea issue/PR URLs inside markdown links collapse to the bare ref.
  result = result.replace(
    new RegExp(`\\[[^\\]]*\\]\\(${urlCore}[^)]*\\)`, "g"),
    (_match, kind: RefKind, number: string) => issueRef(kind, number),
  );

  // 2. Bare Gitea issue/PR URLs collapse to the ref as well.
  result = result.replace(
    new RegExp(`${urlCore}(?:[#?][^\\s)]*)?`, "g"),
    (_match, kind: RefKind, number: string) => issueRef(kind, number),
  );

  // 3. Markdown image embeds become a compact placeholder.
  result = result.replace(
    /!\[([^\]]*)\]\([^)]*\)/g,
    (_match, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]"),
  );

  // 4. Markdown links wrapping a long URL (>80 chars) keep only their label.
  result = result.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, label: string, url: string) => (url.length > 80 ? `[${label}]` : match),
  );

  // 5. Standalone long URLs (>100 chars) are removed entirely.
  result = result.replace(/https?:\/\/[^\s)]+/g, (match) =>
    match.length > 100 ? "[long URL removed]" : match,
  );

  // 6. Email-style quoted blocks of 3+ consecutive `>` lines collapse to a note.
  result = result.replace(
    /(?:^[ \t]*>.*(?:\r?\n|$)){3,}/gm,
    "[quoted text removed]\n",
  );

  return result;
}

/**
 * Return a body for display. Bodies within `maxLen` are returned untouched. When
 * over the limit, cleaning is applied: if the cleaned body now fits it is
 * returned with a "cleaned" note; otherwise it is truncated with the inline
 * "truncated" hint. `N` in both notes is the original body length, since that is
 * what `--full` would reveal.
 */
export function truncateBody(body: string, maxLen: number, host: string): string {
  if (body.length <= maxLen) {
    return body;
  }
  const cleaned = cleanBody(body, host);
  if (cleaned.length <= maxLen) {
    // Reaching here means cleaning shortened an over-limit body to fit, so it
    // necessarily changed the content — hence the unconditional note.
    return `${cleaned}\n(cleaned, ${body.length} chars original - use --full to see original)`;
  }
  return `${cleaned.slice(0, maxLen)}\n... (truncated, ${body.length} chars total - use --full to see complete body)`;
}
