import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedSlateDate,
  getCurrentLeagueId,
  resetCurrentLeagueForTests,
  setCachedSlateDate,
  setCurrentLeagueId,
  subscribeToCurrentLeague,
} from "./current-league-store.js";

beforeEach(() => {
  resetCurrentLeagueForTests();
  localStorage.clear();
});

afterEach(() => {
  resetCurrentLeagueForTests();
  localStorage.clear();
});

describe("current-league-store", () => {
  it("has no current league selected initially", () => {
    expect(getCurrentLeagueId()).toBeNull();
  });

  it("persists the selected league and reflects it immediately", () => {
    setCurrentLeagueId("league-1");
    expect(getCurrentLeagueId()).toBe("league-1");
  });

  it("notifies subscribers on change", () => {
    const listener = vi.fn();
    subscribeToCurrentLeague(listener);

    setCurrentLeagueId("league-1");

    expect(listener).toHaveBeenCalledWith("league-1");
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToCurrentLeague(listener);
    unsubscribe();

    setCurrentLeagueId("league-1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("has no cached slate date for a league it's never seen", () => {
    expect(getCachedSlateDate("league-1")).toBeUndefined();
  });

  it("caches a slate date per league independently", () => {
    setCachedSlateDate("league-1", "2026-08-13");
    setCachedSlateDate("league-2", "2026-08-14");

    expect(getCachedSlateDate("league-1")).toBe("2026-08-13");
    expect(getCachedSlateDate("league-2")).toBe("2026-08-14");
  });

  it("overwrites a stale cached date for the same league", () => {
    setCachedSlateDate("league-1", "2026-08-13");
    setCachedSlateDate("league-1", "2026-08-14");

    expect(getCachedSlateDate("league-1")).toBe("2026-08-14");
  });

  it("survives a fresh module read from localStorage (simulated reload)", () => {
    setCurrentLeagueId("league-1");
    setCachedSlateDate("league-1", "2026-08-13");

    // resetCurrentLeagueForTests only clears in-memory state, not
    // localStorage — asserting the persisted values are still there
    // is the actual "survives a reload" claim; re-importing the
    // module isn't practical in a single test file, so this checks
    // the underlying storage directly instead.
    expect(localStorage.getItem("sports-pickem:current-league-id")).toBe("league-1");
    expect(JSON.parse(localStorage.getItem("sports-pickem:cached-slate-dates") ?? "{}")).toEqual({
      "league-1": "2026-08-13",
    });
  });
});
