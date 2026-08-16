import { describe, expect, it } from "vitest";
import {
  getIsoTimestr,
  getOneYearLaterTimestr,
  getTimestamp,
} from "@/lib/time";

describe("lib/time", () => {
  it("getIsoTimestr 返回 ISO 格式", () => {
    const t = getIsoTimestr();
    expect(new Date(t).toString()).not.toBe("Invalid Date");
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("getTimestamp 返回秒级时间戳", () => {
    const ts = getTimestamp();
    expect(ts).toBe(Math.floor(ts));
    expect(ts).toBeGreaterThan(1_700_000_000);
  });

  it("getOneYearLaterTimestr 约一年后", () => {
    const now = Date.now();
    const later = new Date(getOneYearLaterTimestr()).getTime();
    const diffDays = (later - now) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(360);
    expect(diffDays).toBeLessThan(375);
  });
});
