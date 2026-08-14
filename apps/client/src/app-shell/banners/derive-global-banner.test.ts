import { describe, expect, it } from "vitest";
import type { OpsSummary } from "../../api/types.js";
import { deriveGlobalBanner, type DeriveGlobalBannerInput } from "./derive-global-banner.js";

const BASE: DeriveGlobalBannerInput = {
  online: true,
  wasOfflineRecently: false,
  healthPingFailed: false,
  freshness: undefined,
  unsavedPickCount: 0,
};

function freshness(overrides: Partial<OpsSummary> = {}): OpsSummary {
  return {
    jobs: [],
    staleGameCount: 0,
    correctionsLast24h: 0,
    signupsLast24h: 0,
    picksLast24h: 0,
    slateCompletionRates: [],
    generatedAt: "2026-08-13T18:00:00.000Z",
    ...overrides,
  };
}

describe("deriveGlobalBanner — the priority table", () => {
  it("returns null when nothing is wrong", () => {
    expect(deriveGlobalBanner(BASE)).toBeNull();
  });

  it("offline wins over everything else", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      online: false,
      healthPingFailed: true,
      unsavedPickCount: 5,
      freshness: freshness({ staleGameCount: 3 }),
    });
    expect(result).toEqual({ kind: "offline" });
  });

  it("degraded (health ping failed) wins over reconnecting/unsaved/stale", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      healthPingFailed: true,
      wasOfflineRecently: true,
      unsavedPickCount: 5,
      freshness: freshness({ staleGameCount: 3 }),
    });
    expect(result).toEqual({ kind: "degraded" });
  });

  it("degraded (a tracked job failed) also wins, independent of the health ping", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      freshness: freshness({
        jobs: [{ jobName: "score-poll", lastRunAt: null, lastRunSucceeded: false, lastSuccessAt: null }],
      }),
    });
    expect(result).toEqual({ kind: "degraded" });
  });

  it("a job that simply hasn't run yet (lastRunSucceeded: null) does NOT count as degraded", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      freshness: freshness({
        jobs: [{ jobName: "score-poll", lastRunAt: null, lastRunSucceeded: null, lastSuccessAt: null }],
      }),
    });
    expect(result).toBeNull();
  });

  it("reconnecting wins over unsaved-picks and stale", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      wasOfflineRecently: true,
      unsavedPickCount: 2,
      freshness: freshness({ staleGameCount: 1 }),
    });
    expect(result).toEqual({ kind: "reconnecting" });
  });

  it("unsaved-picks wins over stale", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      unsavedPickCount: 2,
      freshness: freshness({ staleGameCount: 1 }),
    });
    expect(result).toEqual({ kind: "unsaved-picks", count: 2 });
  });

  it("stale is the lowest priority, shown only when nothing else applies", () => {
    const result = deriveGlobalBanner({
      ...BASE,
      freshness: freshness({ staleGameCount: 4, generatedAt: "2026-08-13T18:05:00.000Z" }),
    });
    expect(result).toEqual({ kind: "stale", asOf: "2026-08-13T18:05:00.000Z" });
  });

  it("no freshness data yet and nothing else wrong is null, not stale", () => {
    expect(deriveGlobalBanner({ ...BASE, freshness: undefined })).toBeNull();
  });
});
