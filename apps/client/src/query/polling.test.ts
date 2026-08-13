import { describe, expect, it } from "vitest";
import { computeSlatePollingIntervalMs } from "./polling.js";

describe("computeSlatePollingIntervalMs", () => {
  it("polls fast when a lock is within the 15-minute window", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: 5 * 60 * 1000, hasGamesInProgress: false });
    expect(result).toBe(10_000);
  });

  it("polls fast at exactly the 15-minute boundary (inclusive)", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: 15 * 60 * 1000, hasGamesInProgress: false });
    expect(result).toBe(10_000);
  });

  it("does not fast-poll just outside the 15-minute window", () => {
    const result = computeSlatePollingIntervalMs({
      msUntilNearestLock: 15 * 60 * 1000 + 1,
      hasGamesInProgress: false,
    });
    expect(result).not.toBe(10_000);
  });

  it("polls at a moderate cadence when games are in progress and nothing is about to lock", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: null, hasGamesInProgress: true });
    expect(result).toBe(25_000);
  });

  it("prefers the near-lock cadence over in-progress when both apply", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: 60_000, hasGamesInProgress: true });
    expect(result).toBe(10_000);
  });

  it("does not poll at all when idle — nothing upcoming, nothing in progress", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: null, hasGamesInProgress: false });
    expect(result).toBe(false);
  });

  it("does not poll when the nearest lock is far in the future, even with no games in progress", () => {
    const result = computeSlatePollingIntervalMs({ msUntilNearestLock: 60 * 60 * 1000, hasGamesInProgress: false });
    expect(result).toBe(false);
  });
});
