import { describe, expect, it } from "vitest";
import { deriveGameState, isLegalTransition, isPickable, type GameState } from "./game-state.js";

const STARTS_AT = "2026-08-13T18:00:00.000Z";
const BEFORE = new Date("2026-08-13T17:00:00.000Z").getTime();
const AFTER = new Date("2026-08-13T19:00:00.000Z").getTime();

describe("deriveGameState", () => {
  it("is SCHEDULED for a scheduled game before its start time", () => {
    const state = deriveGameState({ status: "scheduled", startsAt: STARTS_AT, winningTeam: null }, BEFORE);
    expect(state.kind).toBe("SCHEDULED");
  });

  it("is LOCKED for a scheduled game once the corrected clock has passed its start time", () => {
    const state = deriveGameState({ status: "scheduled", startsAt: STARTS_AT, winningTeam: null }, AFTER);
    expect(state.kind).toBe("LOCKED");
  });

  it("is LOCKED for a scheduled game exactly AT its start time (>=, not >)", () => {
    const startTimeMs = new Date(STARTS_AT).getTime();
    const state = deriveGameState({ status: "scheduled", startsAt: STARTS_AT, winningTeam: null }, startTimeMs);
    expect(state.kind).toBe("LOCKED");
  });

  it("is LOCKED for an in_progress game regardless of the clock (in_progress can only happen after start)", () => {
    const state = deriveGameState({ status: "in_progress", startsAt: STARTS_AT, winningTeam: null }, BEFORE);
    expect(state.kind).toBe("LOCKED");
  });

  it("is FINAL with the winning team once status is final and a winner is present", () => {
    const state = deriveGameState({ status: "final", startsAt: STARTS_AT, winningTeam: "Bills" }, AFTER);
    expect(state).toMatchObject({ kind: "FINAL", winningTeam: "Bills" });
  });

  it("falls back to LOCKED (never fabricates a winner) if status is final but winningTeam is somehow null", () => {
    const state = deriveGameState({ status: "final", startsAt: STARTS_AT, winningTeam: null }, AFTER);
    expect(state.kind).toBe("LOCKED");
  });

  it("is VOID with reason 'postponed' for a postponed game, before or after its original start time", () => {
    expect(deriveGameState({ status: "postponed", startsAt: STARTS_AT, winningTeam: null }, BEFORE)).toMatchObject({
      kind: "VOID",
      reason: "postponed",
    });
    expect(deriveGameState({ status: "postponed", startsAt: STARTS_AT, winningTeam: null }, AFTER)).toMatchObject({
      kind: "VOID",
      reason: "postponed",
    });
  });

  it("is VOID with reason 'canceled' for a canceled game", () => {
    const state = deriveGameState({ status: "canceled", startsAt: STARTS_AT, winningTeam: null }, AFTER);
    expect(state).toMatchObject({ kind: "VOID", reason: "canceled" });
  });

  it("accepts a Date object for startsAt, not just an ISO string", () => {
    const state = deriveGameState({ status: "scheduled", startsAt: new Date(STARTS_AT), winningTeam: null }, BEFORE);
    expect(state.kind).toBe("SCHEDULED");
    expect(state.startsAt).toBeInstanceOf(Date);
  });
});

describe("isLegalTransition", () => {
  const scheduled: GameState = { kind: "SCHEDULED", startsAt: new Date(STARTS_AT) };
  const rescheduled: GameState = { kind: "SCHEDULED", startsAt: new Date("2026-08-14T18:00:00.000Z") };
  const locked: GameState = { kind: "LOCKED", startsAt: new Date(STARTS_AT) };
  const final: GameState = { kind: "FINAL", startsAt: new Date(STARTS_AT), winningTeam: "Bills" };
  const finalRevised: GameState = { kind: "FINAL", startsAt: new Date(STARTS_AT), winningTeam: "Jets" };
  const voidPostponed: GameState = { kind: "VOID", startsAt: new Date(STARTS_AT), reason: "postponed" };
  const voidCanceled: GameState = { kind: "VOID", startsAt: new Date(STARTS_AT), reason: "canceled" };

  it("allows every transition explicitly named in the brief", () => {
    expect(isLegalTransition(scheduled, locked)).toBe(true); // start passes
    expect(isLegalTransition(scheduled, rescheduled)).toBe(true); // reschedule
    expect(isLegalTransition(scheduled, voidCanceled)).toBe(true); // cancel
    expect(isLegalTransition(locked, voidCanceled)).toBe(true); // cancel after lock
    expect(isLegalTransition(locked, final)).toBe(true); // final detected
    expect(isLegalTransition(final, finalRevised)).toBe(true); // revision/regrade
  });

  it("allows the postponed-recovery edge the shipped code actually has, beyond the brief's own list", () => {
    expect(isLegalTransition(scheduled, voidPostponed)).toBe(true);
    expect(isLegalTransition(locked, voidPostponed)).toBe(true);
    expect(isLegalTransition(voidPostponed, scheduled)).toBe(true);
    expect(isLegalTransition(voidPostponed, locked)).toBe(true);
  });

  it("rejects a FINAL game un-finalizing — the one genuinely impossible regression", () => {
    expect(isLegalTransition(final, scheduled)).toBe(false);
    expect(isLegalTransition(final, locked)).toBe(false);
    expect(isLegalTransition(final, voidCanceled)).toBe(false);
  });

  it("rejects a canceled (terminal) VOID coming back to life", () => {
    expect(isLegalTransition(voidCanceled, scheduled)).toBe(false);
    expect(isLegalTransition(voidCanceled, locked)).toBe(false);
    expect(isLegalTransition(voidCanceled, final)).toBe(false);
  });

  it("allows a canceled VOID staying canceled (a data refresh, not a real transition)", () => {
    expect(isLegalTransition(voidCanceled, voidCanceled)).toBe(true);
  });
});

describe("isPickable", () => {
  it("is true only for SCHEDULED", () => {
    expect(isPickable({ kind: "SCHEDULED", startsAt: new Date(STARTS_AT) })).toBe(true);
    expect(isPickable({ kind: "LOCKED", startsAt: new Date(STARTS_AT) })).toBe(false);
    expect(isPickable({ kind: "FINAL", startsAt: new Date(STARTS_AT), winningTeam: "Bills" })).toBe(false);
    expect(isPickable({ kind: "VOID", startsAt: new Date(STARTS_AT), reason: "postponed" })).toBe(false);
    expect(isPickable({ kind: "VOID", startsAt: new Date(STARTS_AT), reason: "canceled" })).toBe(false);
  });
});
