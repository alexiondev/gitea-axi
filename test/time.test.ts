import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/time.js";

const now = new Date("2026-07-10T12:00:00Z");

describe("relativeTime", () => {
  it("formats each magnitude bucket", () => {
    expect(relativeTime("2026-07-10T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-07-10T11:45:00Z", now)).toBe("15m ago");
    expect(relativeTime("2026-07-10T07:00:00Z", now)).toBe("5h ago");
    expect(relativeTime("2026-07-03T12:00:00Z", now)).toBe("7d ago");
    expect(relativeTime("2026-05-10T12:00:00Z", now)).toBe("2mo ago");
    expect(relativeTime("2024-07-10T12:00:00Z", now)).toBe("2y ago");
  });

  it("clamps future timestamps to just now", () => {
    expect(relativeTime("2026-07-10T13:00:00Z", now)).toBe("just now");
  });

  it("returns unknown for missing or invalid input, matching gh-axi", () => {
    expect(relativeTime(undefined, now)).toBe("unknown");
    expect(relativeTime("garbage", now)).toBe("unknown");
  });
});
