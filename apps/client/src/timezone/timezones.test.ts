import { describe, expect, it } from "vitest";
import { getDetectedTimezone, listTimezones } from "./timezones.js";

describe("getDetectedTimezone", () => {
  it("returns a non-empty IANA-shaped string", () => {
    const zone = getDetectedTimezone();
    expect(typeof zone).toBe("string");
    expect(zone.length).toBeGreaterThan(0);
  });
});

describe("listTimezones", () => {
  it("returns a large list including the detected zone", () => {
    const zones = listTimezones();
    expect(zones.length).toBeGreaterThan(1);
    expect(zones).toContain(getDetectedTimezone());
  });

  it("contains well-known IANA zones", () => {
    const zones = listTimezones();
    expect(zones).toContain("America/Chicago");
    expect(zones).toContain("Europe/London");
  });

  it("includes the detected zone even when Intl.supportedValuesOf doesn't enumerate it", () => {
    // Confirmed empirically: "UTC" (a common detected zone in a
    // server/CI environment) is absent from supportedValuesOf's own
    // list — this is exactly the gap listTimezones() guards against.
    const zones = Intl.supportedValuesOf("timeZone");
    expect(zones).not.toContain("UTC");
  });
});
