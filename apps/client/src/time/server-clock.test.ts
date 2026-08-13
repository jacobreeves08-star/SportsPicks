import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  correctedDate,
  correctedNow,
  getClockSync,
  onClockSync,
  recordClockSync,
  resetClockSyncForTests,
} from "./server-clock.js";

beforeEach(() => {
  resetClockSyncForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("correctedNow", () => {
  it("falls back to this device's own clock before any sync has happened", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));

    expect(getClockSync()).toBeNull();
    expect(correctedNow()).toBe(Date.now());
  });

  it("corrects a fast device clock back down to the server's real time", () => {
    // Device thinks it's 12:04:00 (4 minutes fast); server, at response
    // time, actually said 12:00:00. Simulate a negligible round trip
    // (both readings the same instant) so the offset is unambiguous.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:04:00.000Z"));
    const now = Date.now();

    recordClockSync("2026-08-13T12:00:00.000Z", now, now);

    // 4 minutes fast -> offset should pull correctedNow() back by ~4 minutes.
    expect(correctedNow()).toBe(new Date("2026-08-13T12:00:00.000Z").getTime());
  });

  it("corrects a slow device clock forward to the server's real time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T11:56:00.000Z"));
    const now = Date.now();

    recordClockSync("2026-08-13T12:00:00.000Z", now, now);

    expect(correctedNow()).toBe(new Date("2026-08-13T12:00:00.000Z").getTime());
  });

  it("splits the round-trip latency in half (NTP-style estimate), not the naive zero-latency reading", () => {
    // Device clock is perfectly accurate. Request starts at device time
    // T, the server's timestamp (also T, by construction here) is
    // generated mid-flight, and the response arrives back at T+100ms.
    // Splitting the 100ms round trip evenly across both legs means the
    // server's timestamp was already ~50ms stale by the time it
    // reached us — the best estimate of "now" at receipt is T+50, half
    // a round trip AHEAD of what the server actually stamped, which
    // means offsetMs is -50 relative to this device's OWN clock
    // reading at receipt (T+100): correctedNow() = (T+100) + (-50) =
    // T+50. A naive "just trust the header verbatim" correction
    // (offset = -100, landing on T) would instead ignore the return
    // leg's travel time entirely and under-correct by a full 50ms on
    // this example — the exact class of error this NTP-style estimate
    // exists to avoid on a slow (bar-wifi-grade) connection.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    const requestStartedAt = Date.now();
    const responseReceivedAt = requestStartedAt + 100;

    const sample = recordClockSync("2026-08-13T12:00:00.000Z", requestStartedAt, responseReceivedAt);

    expect(sample.offsetMs).toBe(-50);
    expect(sample.roundTripMs).toBe(100);
  });

  it("throws on an unparseable header value rather than silently corrupting the offset", () => {
    expect(() => recordClockSync("not-a-date", Date.now(), Date.now())).toThrow(/could not parse/i);
  });
});

describe("correctedDate", () => {
  it("returns a Date built from correctedNow()", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:04:00.000Z"));
    const now = Date.now();
    recordClockSync("2026-08-13T12:00:00.000Z", now, now);

    expect(correctedDate().toISOString()).toBe("2026-08-13T12:00:00.000Z");
  });
});

describe("onClockSync", () => {
  it("notifies subscribers of every new sample and supports unsubscribing", () => {
    const received: number[] = [];
    const unsubscribe = onClockSync((sample) => received.push(sample.offsetMs));

    const now = Date.now();
    recordClockSync(new Date(now).toISOString(), now, now);
    expect(received).toHaveLength(1);

    unsubscribe();
    recordClockSync(new Date(now).toISOString(), now, now);
    expect(received).toHaveLength(1); // no second notification after unsubscribe
  });
});

describe("getClockSync", () => {
  it("exposes the latest sample for staleness/diagnostic checks", () => {
    const now = Date.now();
    recordClockSync(new Date(now).toISOString(), now, now);

    const sample = getClockSync();
    expect(sample).not.toBeNull();
    expect(sample!.syncedAt).toBe(now);
  });
});
