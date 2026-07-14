const PAGE_SIZE = 50;

/**
 * Guard against an unbounded loop if a server ignores paging and always returns
 * a full page. 20 pages of 50 is the 1000-item cap the spec sets on exhaustive
 * pagination (Principle 8).
 */
const PAGE_LIMIT = 20;

interface PageResponse<T> {
  data?: T[];
  headers: Headers;
}

export interface PaginatedResult<T> {
  items: T[];
  /** `X-Total-Count`, absent when the header is missing or not a number. */
  total: number | undefined;
  /**
   * True when pagination stopped at the page cap with every page full, so the
   * set may be incomplete — the dashboard's issue aggregation suffixes its
   * counts with `+` in this case (see the spec's hard 1000-issue cap).
   */
  capped: boolean;
}

export function readTotalCount(headers: Headers): number | undefined {
  const raw = headers.get("x-total-count");
  if (raw === null) {
    return undefined;
  }
  const total = Number(raw);
  return Number.isFinite(total) ? total : undefined;
}

/**
 * Read every page, stopping at the first short one or at the page cap. Needed by
 * the client-side policies (see ADR 0005): a command sorting or filtering
 * in-process cannot do either correctly until it holds the whole set.
 *
 * The total comes from the first page and describes the set the API returned, so
 * it stays accurate under sorting (which only reorders) but not under
 * client-side filtering, whose caller counts the filtered set itself.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<PageResponse<T>>,
): Promise<PaginatedResult<T>> {
  const items: T[] = [];
  let total: number | undefined;
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const response = await fetchPage(page, PAGE_SIZE);
    if (page === 1) {
      total = readTotalCount(response.headers);
    }
    const batch = response.data ?? [];
    items.push(...batch);
    // A short page is the last page: the set is complete.
    if (batch.length < PAGE_SIZE) {
      return { items, total, capped: false };
    }
  }
  // Every page up to the cap came back full, so there may be more beyond it.
  return { items, total, capped: true };
}
