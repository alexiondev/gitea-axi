const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeTime(iso: string | undefined, now: Date): string {
  if (!iso) {
    return "unknown";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "unknown";
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < MINUTE) {
    return "just now";
  }
  if (seconds < HOUR) {
    return `${Math.floor(seconds / MINUTE)}m ago`;
  }
  if (seconds < DAY) {
    return `${Math.floor(seconds / HOUR)}h ago`;
  }
  if (seconds < MONTH) {
    return `${Math.floor(seconds / DAY)}d ago`;
  }
  if (seconds < YEAR) {
    return `${Math.floor(seconds / MONTH)}mo ago`;
  }
  return `${Math.floor(seconds / YEAR)}y ago`;
}
