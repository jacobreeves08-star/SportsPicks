import { describe, expect, it } from "vitest";
import { dayBoundsUtc, isValidIanaTimeZone, parseIsoUtc, toUtcIso, toZonedDisplay, weekBoundsUtc } from "./time.js";

describe("time helpers", () => {
  it("round-trips an ISO UTC timestamp", () => {
    const dt = parseIsoUtc("2026-01-15T18:30:00.000Z");
    expect(toUtcIso(dt)).toBe("2026-01-15T18:30:00.000Z");
  });

  it("rejects an invalid ISO string", () => {
    expect(() => parseIsoUtc("not-a-timestamp")).toThrow(/Invalid ISO-8601/);
  });

  it("converts a UTC instant to a local display zone without changing the instant", () => {
    const dt = parseIsoUtc("2026-07-04T23:00:00.000Z"); // DST-affected date on purpose
    const local = toZonedDisplay(dt, "America/New_York");
    expect(local.toISO()).toBe("2026-07-04T19:00:00.000-04:00");
    expect(local.toUTC().toISO()).toBe(toUtcIso(dt));
  });

  it("validates IANA time zone names", () => {
    expect(isValidIanaTimeZone("America/Chicago")).toBe(true);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
  });

  describe("dayBoundsUtc", () => {
    it("computes UTC day bounds for a timezone behind UTC (America/Chicago, CST)", () => {
      // 2026-01-15 00:00 America/Chicago (CST, UTC-6) is 2026-01-15T06:00:00Z.
      const { start, end } = dayBoundsUtc("2026-01-15", "America/Chicago");
      expect(start.toISOString()).toBe("2026-01-15T06:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-16T06:00:00.000Z");
    });

    it("computes UTC day bounds for a timezone ahead of UTC (Asia/Tokyo)", () => {
      // 2026-01-15 00:00 Asia/Tokyo (UTC+9) is 2026-01-14T15:00:00Z.
      const { start, end } = dayBoundsUtc("2026-01-15", "Asia/Tokyo");
      expect(start.toISOString()).toBe("2026-01-14T15:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-15T15:00:00.000Z");
    });

    it("a UTC-adjacent instant just before the boundary belongs to the PREVIOUS day", () => {
      const { start } = dayBoundsUtc("2026-01-15", "America/Chicago");
      const oneMsBefore = new Date(start.getTime() - 1);
      // 2026-01-15T05:59:59.999Z is still 2026-01-14 in America/Chicago.
      expect(oneMsBefore.toISOString()).toBe("2026-01-15T05:59:59.999Z");
    });

    it("throws for an invalid timezone", () => {
      expect(() => dayBoundsUtc("2026-01-15", "Not/AZone")).toThrow(/Invalid date/);
    });
  });

  // 2026-01-15 is a Thursday; 2026-01-13 the preceding Tuesday;
  // 2026-01-12 the preceding Monday (last day of the PRIOR week).
  describe("weekBoundsUtc (Tuesday-to-Monday, JAC-37-42)", () => {
    it("a mid-week date resolves to that week's Tuesday-Monday span", () => {
      const { start, end } = weekBoundsUtc("2026-01-15", "America/Chicago");
      expect(start.toISOString()).toBe("2026-01-13T06:00:00.000Z"); // Tue 2026-01-13 00:00 CST
      expect(end.toISOString()).toBe("2026-01-20T06:00:00.000Z"); // Tue 2026-01-20 00:00 CST
    });

    it("Tuesday itself is the first day of its own week", () => {
      const { start, end } = weekBoundsUtc("2026-01-13", "America/Chicago");
      expect(start.toISOString()).toBe("2026-01-13T06:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-20T06:00:00.000Z");
    });

    it("Monday is the LAST day of its week, not the first of the next", () => {
      const { start, end } = weekBoundsUtc("2026-01-12", "America/Chicago");
      expect(start.toISOString()).toBe("2026-01-06T06:00:00.000Z"); // Tue 2026-01-06 00:00 CST
      expect(end.toISOString()).toBe("2026-01-13T06:00:00.000Z"); // exclusive — next Tuesday
    });

    it("computes week bounds for a timezone ahead of UTC (Asia/Tokyo)", () => {
      const { start, end } = weekBoundsUtc("2026-01-15", "Asia/Tokyo");
      expect(start.toISOString()).toBe("2026-01-12T15:00:00.000Z"); // Tue 2026-01-13 00:00 JST
      expect(end.toISOString()).toBe("2026-01-19T15:00:00.000Z"); // Tue 2026-01-20 00:00 JST
    });

    it("throws for an invalid timezone", () => {
      expect(() => weekBoundsUtc("2026-01-15", "Not/AZone")).toThrow(/Invalid date/);
    });
  });
});
