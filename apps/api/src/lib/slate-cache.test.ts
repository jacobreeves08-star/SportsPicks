import { beforeEach, describe, expect, it } from "vitest";
import { clearSlateCacheForTests, getCachedSlate, invalidateLeague, setCachedSlate } from "./slate-cache.js";

beforeEach(() => {
  clearSlateCacheForTests();
});

describe("slate-cache (JAC-43-48)", () => {
  it("returns undefined for a key that was never set", () => {
    expect(getCachedSlate("league-1", "2026-01-15", "member-1")).toBeUndefined();
  });

  it("returns the cached value within the TTL", () => {
    setCachedSlate("league-1", "2026-01-15", "member-1", { games: [] }, 60);
    expect(getCachedSlate("league-1", "2026-01-15", "member-1")).toEqual({ games: [] });
  });

  it("expires after the given TTL", async () => {
    setCachedSlate("league-1", "2026-01-15", "member-1", { games: [] }, 0.05);
    await new Promise((r) => setTimeout(r, 100));
    expect(getCachedSlate("league-1", "2026-01-15", "member-1")).toBeUndefined();
  });

  it("keys are isolated by league, date, and viewer independently", () => {
    setCachedSlate("league-1", "2026-01-15", "member-1", "A", 60);
    setCachedSlate("league-2", "2026-01-15", "member-1", "B", 60);
    setCachedSlate("league-1", "2026-01-16", "member-1", "C", 60);
    setCachedSlate("league-1", "2026-01-15", "member-2", "D", 60);

    expect(getCachedSlate("league-1", "2026-01-15", "member-1")).toBe("A");
    expect(getCachedSlate("league-2", "2026-01-15", "member-1")).toBe("B");
    expect(getCachedSlate("league-1", "2026-01-16", "member-1")).toBe("C");
    expect(getCachedSlate("league-1", "2026-01-15", "member-2")).toBe("D");
  });

  it("invalidateLeague clears every date/viewer entry for that league, and no others", () => {
    setCachedSlate("league-1", "2026-01-15", "member-1", "A", 60);
    setCachedSlate("league-1", "2026-01-16", "member-2", "B", 60);
    setCachedSlate("league-2", "2026-01-15", "member-1", "C", 60);

    invalidateLeague("league-1");

    expect(getCachedSlate("league-1", "2026-01-15", "member-1")).toBeUndefined();
    expect(getCachedSlate("league-1", "2026-01-16", "member-2")).toBeUndefined();
    expect(getCachedSlate("league-2", "2026-01-15", "member-1")).toBe("C"); // untouched
  });

  it("invalidating a league with no cached entries is a safe no-op", () => {
    expect(() => invalidateLeague("nonexistent-league")).not.toThrow();
  });
});
