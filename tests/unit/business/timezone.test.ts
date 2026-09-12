import { describe, expect, it } from "vitest";
import { isValidTimeZone, startOfDayInTimeZone, startOfNextDayInTimeZone } from "@/lib/business/timezone";

describe("isValidTimeZone", () => {
  it("accepts real IANA zone names", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Istanbul")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("banana")).toBe(false);
  });
});

describe("startOfDayInTimeZone", () => {
  it("UTC: midnight is a no-op shift", () => {
    const at = new Date("2024-06-15T13:45:00.000Z");
    expect(startOfDayInTimeZone("UTC", at).toISOString()).toBe("2024-06-15T00:00:00.000Z");
  });

  it("a fixed-offset zone ahead of UTC (Europe/Istanbul, UTC+3 year-round): local midnight is the previous UTC day", () => {
    const at = new Date("2024-06-15T13:45:00.000Z");
    expect(startOfDayInTimeZone("Europe/Istanbul", at).toISOString()).toBe("2024-06-14T21:00:00.000Z");
  });

  it("a zone behind UTC (America/New_York): local midnight is later the same UTC day", () => {
    // 2024-01-15 is standard time in New York (UTC-5).
    const at = new Date("2024-01-15T22:00:00.000Z");
    expect(startOfDayInTimeZone("America/New_York", at).toISOString()).toBe("2024-01-15T05:00:00.000Z");
  });

  it("is DST-aware — the same zone's offset differs between a standard-time and daylight-time date", () => {
    // 2024-07-15 is daylight time in New York (UTC-4), not UTC-5.
    const at = new Date("2024-07-15T22:00:00.000Z");
    expect(startOfDayInTimeZone("America/New_York", at).toISOString()).toBe("2024-07-15T04:00:00.000Z");
  });

  it("defaults `at` to now and still returns a valid Date", () => {
    const result = startOfDayInTimeZone("UTC");
    expect(result instanceof Date).toBe(true);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});

describe("startOfNextDayInTimeZone", () => {
  it("UTC: exactly 24h after startOfDayInTimeZone", () => {
    const at = new Date("2024-06-15T13:45:00.000Z");
    expect(startOfNextDayInTimeZone("UTC", at).toISOString()).toBe("2024-06-16T00:00:00.000Z");
  });

  it("a fixed-offset zone ahead of UTC (Europe/Istanbul, UTC+3 year-round)", () => {
    const at = new Date("2024-06-15T13:45:00.000Z");
    expect(startOfNextDayInTimeZone("Europe/Istanbul", at).toISOString()).toBe("2024-06-15T21:00:00.000Z");
  });

  it("a zone behind UTC (America/New_York, standard time)", () => {
    const at = new Date("2024-01-15T22:00:00.000Z");
    expect(startOfNextDayInTimeZone("America/New_York", at).toISOString()).toBe("2024-01-16T05:00:00.000Z");
  });

  it("straddles a spring-forward DST transition without drifting off the next calendar day", () => {
    // 2024-03-10 is the US spring-forward date (2am -> 3am, a 23h local day)
    // in America/New_York — starting from just before it, "tomorrow" must
    // still land on the calendar day after, not slip back a day.
    const at = new Date("2024-03-09T12:00:00.000Z");
    const next = startOfNextDayInTimeZone("America/New_York", at);
    expect(next.toISOString()).toBe(startOfDayInTimeZone("America/New_York", new Date("2024-03-10T12:00:00.000Z")).toISOString());
  });

  it("is exactly one calendar day after startOfDayInTimeZone for the same instant", () => {
    const at = new Date("2024-07-15T22:00:00.000Z");
    const start = startOfDayInTimeZone("America/New_York", at);
    const next = startOfNextDayInTimeZone("America/New_York", at);
    // DST-aware: the daylight-time day here is exactly 24h wall-clock apart in UTC terms too.
    expect(next.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("defaults `at` to now and still returns a valid Date strictly after startOfDayInTimeZone", () => {
    const start = startOfDayInTimeZone("UTC");
    const next = startOfNextDayInTimeZone("UTC");
    expect(next.getTime()).toBeGreaterThan(start.getTime());
  });
});
