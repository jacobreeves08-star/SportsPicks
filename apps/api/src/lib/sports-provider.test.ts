import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ESPN_SPORT_SLUGS,
  EspnSportsProvider,
  MockSportsProvider,
  toCanonicalStatus,
} from "./sports-provider.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/espn");

// No real delays in these tests — withRetry's actual backoff/attempt
// logic is already covered by retry.test.ts; here we just need it to
// not add wall-clock time while exercising EspnSportsProvider's own
// retry/circuit-breaker wiring.
const instantSleep = async (_ms: number) => {};

function newProvider(): EspnSportsProvider {
  return new EspnSportsProvider(undefined, { sleepFn: instantSleep });
}

function loadFixtureEvent(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
}

function loadFixtureEvents(name: string): unknown[] {
  return (loadFixtureEvent(name) as { events: unknown[] }).events;
}

/** Stubs global fetch to return `events` regardless of which URL is hit —
 * fine for these tests since each one only issues a single scoreboard call. */
function stubFetchOnce(events: unknown[], ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      json: async () => ({ events }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toCanonicalStatus", () => {
  it("maps completed:true to final regardless of name — the authoritative signal", () => {
    expect(toCanonicalStatus({ completed: true, state: "post", name: "STATUS_FULL_TIME" })).toBe("final");
    expect(toCanonicalStatus({ completed: true, state: "post", name: "STATUS_FINAL_PEN" })).toBe("final");
    expect(toCanonicalStatus({ completed: true, state: "post", name: "STATUS_FINAL" })).toBe("final");
  });

  it("NEVER maps a non-completed status to final, no matter the name or state — invariant #6", () => {
    // A lopsided score would live in a `score` field this schema doesn't
    // even read; completed:false is the only thing that matters.
    expect(toCanonicalStatus({ completed: false, state: "in", name: "STATUS_IN_PROGRESS" })).not.toBe("final");
    expect(toCanonicalStatus({ completed: false, state: "in", name: "STATUS_HALFTIME" })).not.toBe("final");
  });

  it("maps pre/in state to scheduled/in_progress", () => {
    expect(toCanonicalStatus({ completed: false, state: "pre", name: "STATUS_SCHEDULED" })).toBe("scheduled");
    expect(toCanonicalStatus({ completed: false, state: "in", name: "STATUS_IN_PROGRESS" })).toBe("in_progress");
  });

  it("maps postponed/suspended/canceled by name", () => {
    expect(toCanonicalStatus({ completed: false, state: "post", name: "STATUS_POSTPONED" })).toBe("postponed");
    expect(toCanonicalStatus({ completed: false, state: "post", name: "STATUS_SUSPENDED" })).toBe("postponed");
    expect(toCanonicalStatus({ completed: false, state: "post", name: "STATUS_CANCELED" })).toBe("canceled");
  });

  it("returns null (fail-safe) for anything unrecognized, never guesses", () => {
    expect(toCanonicalStatus({ completed: false, state: "weird", name: "STATUS_MADE_UP" })).toBeNull();
  });
});

describe("ESPN_SPORT_SLUGS", () => {
  it("covers all 11 sports in scope with the correct draw eligibility", () => {
    expect(Object.keys(ESPN_SPORT_SLUGS).sort()).toEqual(
      ["epl", "mlb", "mma", "nba", "ncaamb", "ncaaf", "nfl", "nhl", "mls", "tennis", "ucl"].sort(),
    );
    expect(ESPN_SPORT_SLUGS.nfl!.allowsDraw).toBe(false);
    expect(ESPN_SPORT_SLUGS.nhl!.allowsDraw).toBe(false);
    expect(ESPN_SPORT_SLUGS.tennis!.allowsDraw).toBe(false);
    expect(ESPN_SPORT_SLUGS.mma!.allowsDraw).toBe(false);
    expect(ESPN_SPORT_SLUGS.epl!.allowsDraw).toBe(true);
    expect(ESPN_SPORT_SLUGS.ucl!.allowsDraw).toBe(true);
    expect(ESPN_SPORT_SLUGS.mls!.allowsDraw).toBe(true);
  });

  it("uses the expected ESPN sport/league slug and matchStyle per sport", () => {
    expect(ESPN_SPORT_SLUGS.tennis).toEqual({
      espnSport: "tennis",
      espnLeague: "atp",
      allowsDraw: false,
      matchStyle: "individual-grouped",
    });
    expect(ESPN_SPORT_SLUGS.mma).toEqual({
      espnSport: "mma",
      espnLeague: "ufc",
      allowsDraw: false,
      matchStyle: "individual-flat",
    });
    expect(ESPN_SPORT_SLUGS.nfl!.matchStyle).toBe("team");
  });
});

describe("EspnSportsProvider.fetchSchedule", () => {
  it("maps a real scheduled event correctly", async () => {
    stubFetchOnce([loadFixtureEvent("scheduled")]);
    const provider = newProvider();
    const [entry] = await provider.fetchSchedule({ sport: "mlb", fromDate: "20260812", toDate: "20260812" });
    expect(entry).toMatchObject({
      externalId: "401816500",
      sport: "mlb",
      status: "scheduled",
      homeTeam: {
        externalId: "9",
        displayName: "Minnesota Twins",
        logoUrl: "https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/min.png",
        color: "002b5c",
      },
      awayTeam: {
        externalId: "1",
        displayName: "Baltimore Orioles",
        logoUrl: "https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/bal.png",
        color: "df4601",
      },
      allowsDraw: false,
    });
  });

  it("defaults logoUrl/color to null when ESPN's response omits those team fields", async () => {
    stubFetchOnce([loadFixtureEvent("final-non-soccer")]);
    const provider = newProvider();
    const [entry] = await provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" });
    expect(entry!.homeTeam.logoUrl).toBeNull();
    expect(entry!.awayTeam.logoUrl).toBeNull();
    expect(entry!.homeTeam.color).toBeNull();
    expect(entry!.awayTeam.color).toBeNull();
  });

  it("maps a real final (non-soccer) event correctly", async () => {
    stubFetchOnce([loadFixtureEvent("final-non-soccer")]);
    const provider = newProvider();
    const [entry] = await provider.fetchSchedule({ sport: "mlb", fromDate: "20260811", toDate: "20260811" });
    expect(entry?.status).toBe("final");
  });

  it("stamps allowsDraw from ESPN_SPORT_SLUGS for a soccer sport", async () => {
    stubFetchOnce([loadFixtureEvent("draw")]);
    const provider = newProvider();
    const [entry] = await provider.fetchSchedule({ sport: "epl", fromDate: "20260412", toDate: "20260412" });
    expect(entry?.allowsDraw).toBe(true);
  });

  it("never produces status:final for a lopsided-but-not-completed game — invariant #6 at the adapter level", async () => {
    stubFetchOnce([loadFixtureEvent("lopsided-not-final")]);
    const provider = newProvider();
    const [entry] = await provider.fetchSchedule({ sport: "nfl", fromDate: "20260914", toDate: "20260914" });
    expect(entry?.status).not.toBe("final");
    expect(entry?.status).toBe("in_progress");
  });

  it("skips an event with an unrecognized status rather than crashing the whole call", async () => {
    stubFetchOnce([loadFixtureEvent("unrecognized-status"), loadFixtureEvent("scheduled")]);
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "mlb", fromDate: "20260812", toDate: "20260812" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.externalId).toBe("401816500");
  });

  it("a real multi-day date-range response produces entries spanning multiple dates", async () => {
    stubFetchOnce(loadFixtureEvents("date-range"));
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "ncaaf", fromDate: "20250901", toDate: "20250908" });
    const distinctDates = new Set(entries.map((e) => e.startsAt.toISOString().slice(0, 10)));
    expect(distinctDates.size).toBeGreaterThan(1);
  });

  it("throws for an unknown sport code rather than silently no-op-ing", async () => {
    const provider = newProvider();
    await expect(
      provider.fetchSchedule({ sport: "curling", fromDate: "20260101", toDate: "20260101" }),
    ).rejects.toThrow(/Unknown sport code/);
  });
});

describe("EspnSportsProvider.fetchResults", () => {
  it("maps a real penalty-shootout final to the correct winning side", async () => {
    stubFetchOnce([loadFixtureEvent("final-penalties")]);
    const provider = newProvider();
    const [result] = await provider.fetchResults([{ externalId: "401862897", sport: "ucl", date: "20260530" }]);
    expect(result).toEqual({ externalId: "401862897", status: "final", winnerSide: "home" }); // PSG is home, won on pens
  });

  it("maps a real genuine draw to winnerSide 'draw'", async () => {
    stubFetchOnce([loadFixtureEvent("draw")]);
    const provider = newProvider();
    const [result] = await provider.fetchResults([{ externalId: "740914", sport: "epl", date: "20260412" }]);
    expect(result).toEqual({ externalId: "740914", status: "final", winnerSide: "draw" });
  });

  it("filters results down to only the requested externalIds", async () => {
    stubFetchOnce([loadFixtureEvent("final-non-soccer"), loadFixtureEvent("scheduled")]);
    const provider = newProvider();
    const results = await provider.fetchResults([{ externalId: "401816481", sport: "mlb", date: "20260811" }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.externalId).toBe("401816481");
  });

  it("never returns winnerSide for a non-final status", async () => {
    stubFetchOnce([loadFixtureEvent("in-progress")]);
    const provider = newProvider();
    const [result] = await provider.fetchResults([{ externalId: "999000004", sport: "nfl", date: "20260917" }]);
    expect(result?.status).toBe("in_progress");
    expect(result?.winnerSide).toBeNull();
  });
});

describe("EspnSportsProvider.fetchSchedule — individual sports (tennis, MMA)", () => {
  it("flattens a tennis tournament's Men's Singles matches, using the MATCH's own id/date, and excludes doubles", async () => {
    stubFetchOnce([loadFixtureEvent("tennis-tournament")]);
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "tennis", fromDate: "20260811", toDate: "20260811" });

    expect(entries).toHaveLength(1); // the one singles match — the doubles match is excluded
    expect(entries[0]).toMatchObject({
      externalId: "184414", // the MATCH's id, not the tournament event's id ("718-2026")
      sport: "tennis",
      status: "scheduled",
      homeTeam: { externalId: "4030", displayName: "Dane Sweeny" },
      awayTeam: { externalId: "4444", displayName: "Christopher O'Connell" },
      allowsDraw: false,
    });
    expect(entries[0]!.startsAt.toISOString()).toBe("2026-08-11T16:05:00.000Z"); // the match's own date, not the tournament's
  });

  it("flattens every fight on an MMA card into its own entry, using each fight's own id/date, home/away synthesized from order", async () => {
    stubFetchOnce([loadFixtureEvent("mma-card")]);
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "mma", fromDate: "20260815", toDate: "20260815" });

    expect(entries).toHaveLength(2); // both fights on the card, not just the card itself
    expect(entries[0]).toMatchObject({
      externalId: "401886760",
      status: "final",
      homeTeam: { externalId: "3001914", displayName: "Jeremiah Wells" }, // order:1
      awayTeam: { externalId: "4297311", displayName: "Themba Gorimbo" }, // order:2
    });
    expect(entries[1]).toMatchObject({
      externalId: "401886763",
      status: "scheduled",
      homeTeam: { externalId: "3970873", displayName: "Islam Makhachev" },
      awayTeam: { externalId: "4685438", displayName: "Jack Della Maddalena" },
    });
    // Each fight keeps its OWN start time, not the card's shared event.date.
    expect(entries[0]!.startsAt.toISOString()).toBe("2026-08-15T21:05:00.000Z");
    expect(entries[1]!.startsAt.toISOString()).toBe("2026-08-15T23:30:00.000Z");
  });
});

describe("EspnSportsProvider.fetchResults — individual sports (tennis, MMA)", () => {
  it("resolves an MMA fight's winner via order-synthesized home/away, matching on the fight's own id", async () => {
    stubFetchOnce([loadFixtureEvent("mma-card")]);
    const provider = newProvider();
    const [result] = await provider.fetchResults([{ externalId: "401886760", sport: "mma", date: "20260815" }]);
    expect(result).toEqual({ externalId: "401886760", status: "final", winnerSide: "home" }); // Wells (order:1) won
  });

  it("a still-scheduled tennis match has no winnerSide", async () => {
    stubFetchOnce([loadFixtureEvent("tennis-tournament")]);
    const provider = newProvider();
    const [result] = await provider.fetchResults([{ externalId: "184414", sport: "tennis", date: "20260811" }]);
    expect(result?.status).toBe("scheduled");
    expect(result?.winnerSide).toBeNull();
  });
});

describe("EspnSportsProvider error handling", () => {
  it("returns zero events (not a throw) when the response fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ totally: "not the expected shape" }) })),
    );
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" });
    expect(entries).toEqual([]);
  });

  it("retries a 5xx and eventually succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 2) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ events: [loadFixtureEvent("scheduled")] }) };
      }),
    );
    const provider = newProvider();
    const entries = await provider.fetchSchedule({ sport: "mlb", fromDate: "20260812", toDate: "20260812" });
    expect(entries).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("trips the in-run circuit breaker after repeated failures and fails fast on the next call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    const provider = newProvider();

    // Each fetchSchedule call retries internally (3 attempts) and then
    // records one circuit-breaker failure. 3 calls = 3 recorded
    // failures = breaker trips (threshold 3).
    await expect(provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" })).rejects.toThrow();
    await expect(provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" })).rejects.toThrow();
    await expect(provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" })).rejects.toThrow();

    const fetchMock = vi.mocked(fetch);
    const callsBeforeTrip = fetchMock.mock.calls.length;

    await expect(provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" })).rejects.toThrow(
      /circuit breaker open/i,
    );
    // The tripped call should fail immediately, without hitting fetch again.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeTrip);
  });
});

describe("MockSportsProvider", () => {
  it("returns nothing by default — zero network, zero surprises", async () => {
    const provider = new MockSportsProvider();
    expect(await provider.fetchSchedule({ sport: "nfl", fromDate: "20260101", toDate: "20260101" })).toEqual([]);
    expect(await provider.fetchResults([{ externalId: "x", sport: "nfl", date: "20260101" }])).toEqual([]);
  });

  it("returns canned schedule/results, filtering fetchResults by requested externalId", async () => {
    const provider = new MockSportsProvider({
      results: [
        { externalId: "a", status: "final", winnerSide: "home" },
        { externalId: "b", status: "final", winnerSide: "away" },
      ],
    });
    const results = await provider.fetchResults([{ externalId: "a", sport: "nfl", date: "20260101" }]);
    expect(results).toEqual([{ externalId: "a", status: "final", winnerSide: "home" }]);
  });
});
