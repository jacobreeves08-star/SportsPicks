import { describe, expect, it } from "vitest";
import { addDays } from "./slate-date.js";

describe("addDays", () => {
  it("adds a day within a month", () => {
    expect(addDays("2026-08-13", 1)).toBe("2026-08-14");
  });

  it("subtracts a day within a month", () => {
    expect(addDays("2026-08-13", -1)).toBe("2026-08-12");
  });

  it("rolls over a month boundary going forward", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("rolls over a month boundary going backward", () => {
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles a leap day correctly", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("is unaffected by the host's local timezone (UTC-anchored)", () => {
    // Regression guard: a naive `new Date("2026-08-13")` + `setDate()`
    // approach can drift a day depending on the browser's local zone.
    // Run repeatedly, this must always land on the same UTC calendar
    // date regardless of when/where the test executes.
    expect(addDays("2026-01-01", 0)).toBe("2026-01-01");
  });
});
