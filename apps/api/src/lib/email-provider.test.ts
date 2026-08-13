import { describe, expect, it } from "vitest";
import { createEmailProvider } from "./email-provider.js";

describe("createEmailProvider", () => {
  it("mock provider never throws and needs no network for every method", async () => {
    const provider = createEmailProvider("mock");
    await expect(provider.sendVerificationEmail("a@example.com", "https://x/verify")).resolves.toBeUndefined();
    await expect(
      provider.sendEmailChangeVerification("a@example.com", "https://x/verify-change"),
    ).resolves.toBeUndefined();
    await expect(provider.sendPasswordResetEmail("a@example.com", "https://x/reset")).resolves.toBeUndefined();
    await expect(provider.sendDuplicateSignupNotice("a@example.com")).resolves.toBeUndefined();
    await expect(
      provider.sendPickReminderEmail("a@example.com", {
        leagueName: "Test League",
        unpickedGames: [{ homeTeam: "Bills", awayTeam: "Jets", startsAt: new Date() }],
        firstLockAt: new Date(),
        timezone: "America/Chicago",
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.sendResultsSummaryEmail("a@example.com", {
        leagueName: "Test League",
        wins: 2,
        losses: 1,
        rank: 1,
        rankChange: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.sendOperatorDigestEmail("ops@example.com", {
        jobs: [{ jobName: "score-poll", lastRunAt: new Date(), lastRunSucceeded: true, lastSuccessAt: new Date() }],
        staleGameCount: 0,
        correctionsLast24h: 0,
        signupsLast24h: 1,
        picksLast24h: 3,
        slateCompletionRates: [
          { leagueId: "league-1", leagueName: "Test League", totalMembers: 2, completedCount: 1, rate: 0.5 },
        ],
        generatedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it("mock and resend providers are distinct implementations", () => {
    const mock = createEmailProvider("mock");
    expect(mock).toBeInstanceOf(Object);
    // The Resend SDK itself throws at construction without an API key
    // (checks its own key param, falls back to process.env.RESEND_API_KEY)
    // — RESEND_API_KEY is unset in test env, so this confirms the factory
    // actually wires the live provider through to the real SDK rather
    // than silently no-op-ing.
    expect(() => createEmailProvider("resend")).toThrow(/API key/i);
  });
});
