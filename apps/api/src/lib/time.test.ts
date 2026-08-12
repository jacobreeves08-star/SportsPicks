import { describe, expect, it } from "vitest";
import { isValidIanaTimeZone, parseIsoUtc, toUtcIso, toZonedDisplay } from "./time.js";

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
});
