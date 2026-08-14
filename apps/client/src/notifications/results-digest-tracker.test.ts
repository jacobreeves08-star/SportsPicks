import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLastShownDate, markShownToday, resetResultsDigestTrackerForTests, todayLocalDate } from "./results-digest-tracker.js";

beforeEach(() => {
  resetResultsDigestTrackerForTests();
});

afterEach(() => {
  resetResultsDigestTrackerForTests();
});

describe("results-digest-tracker", () => {
  it("has no last-shown date initially", () => {
    expect(getLastShownDate()).toBeNull();
  });

  it("remembers the date once marked", () => {
    markShownToday("2026-08-13");
    expect(getLastShownDate()).toBe("2026-08-13");
  });

  it("a later mark overwrites an earlier one — this repeats daily, unlike a one-time flag", () => {
    markShownToday("2026-08-13");
    markShownToday("2026-08-14");
    expect(getLastShownDate()).toBe("2026-08-14");
  });

  it("persists in localStorage directly (survives a simulated reload)", () => {
    markShownToday("2026-08-13");
    expect(localStorage.getItem("sports-pickem:results-digest-last-shown-date")).toBe("2026-08-13");
  });
});

describe("todayLocalDate", () => {
  it("matches the device's own local date fields, not UTC", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayLocalDate()).toBe(expected);
  });
});
