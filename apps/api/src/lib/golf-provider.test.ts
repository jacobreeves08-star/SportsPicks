import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EspnGolfProvider, MockGolfProvider } from "./golf-provider.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/espn");

const instantSleep = async (_ms: number) => {};

function newProvider(): EspnGolfProvider {
  return new EspnGolfProvider(undefined, { sleepFn: instantSleep });
}

function loadFixtureEvent(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8"));
}

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

describe("EspnGolfProvider.fetchTournaments", () => {
  it("maps a real in-progress tournament and its leaderboard, using `order` as position", async () => {
    stubFetchOnce([loadFixtureEvent("golf-in-progress")]);
    const provider = newProvider();
    const [snapshot] = await provider.fetchTournaments({ fromDate: "20260813", toDate: "20260816" });

    expect(snapshot?.tournament).toMatchObject({
      externalId: "401811962",
      name: "FedEx St. Jude Championship",
      status: "in_progress",
    });
    expect(snapshot?.tournament.startsAt.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(snapshot?.tournament.endsAt.toISOString()).toBe("2026-08-16T04:00:00.000Z");
    // The third golfer deliberately has no `flag` in the fixture — one
    // leaderboard covers both the populated and the absent case, since
    // a missing flag must produce null rather than failing the parse.
    expect(snapshot?.leaderboard).toEqual([
      {
        externalId: "9478",
        golferName: "Scottie Scheffler",
        flagUrl: "https://a.espncdn.com/i/teamlogos/countries/500/usa.png",
        position: 1,
      },
      {
        externalId: "11382",
        golferName: "Sungjae Im",
        flagUrl: "https://a.espncdn.com/i/teamlogos/countries/500/kor.png",
        position: 2,
      },
      { externalId: "4375972", golferName: "Ludvig Åberg", flagUrl: null, position: 3 },
    ]);
  });

  it("an upcoming tournament whose field ISN'T published yet still ingests, with an empty leaderboard", async () => {
    // Confirmed live: an upcoming PGA event's competition object omits
    // `competitors` ENTIRELY (not an empty array). Requiring it would
    // drop exactly the tournaments members need to see, since golf picks
    // must be made BEFORE the tournament starts.
    stubFetchOnce([loadFixtureEvent("golf-scheduled")]);
    const provider = newProvider();
    const [snapshot] = await provider.fetchTournaments({ fromDate: "20260820", toDate: "20260823" });

    expect(snapshot?.tournament).toMatchObject({ externalId: "401811963", name: "BMW Championship", status: "scheduled" });
    expect(snapshot?.leaderboard).toEqual([]);
  });

  it("returns zero snapshots (not a throw) when the response fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ totally: "not the expected shape" }) })),
    );
    const provider = newProvider();
    const snapshots = await provider.fetchTournaments({ fromDate: "20260101", toDate: "20260101" });
    expect(snapshots).toEqual([]);
  });

  it("skips one malformed event but keeps the rest", async () => {
    stubFetchOnce([{ id: "bad" }, loadFixtureEvent("golf-in-progress")]);
    const provider = newProvider();
    const snapshots = await provider.fetchTournaments({ fromDate: "20260813", toDate: "20260816" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.tournament.externalId).toBe("401811962");
  });

  it("retries a 5xx and eventually succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls < 2) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ events: [loadFixtureEvent("golf-in-progress")] }) };
      }),
    );
    const provider = newProvider();
    const snapshots = await provider.fetchTournaments({ fromDate: "20260813", toDate: "20260813" });
    expect(snapshots).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe("MockGolfProvider", () => {
  it("returns nothing by default — zero network, zero surprises", async () => {
    const provider = new MockGolfProvider();
    expect(await provider.fetchTournaments({ fromDate: "20260101", toDate: "20260101" })).toEqual([]);
  });

  it("returns canned tournaments regardless of the requested date range", async () => {
    const snapshot = {
      tournament: {
        externalId: "t1",
        name: "Test Open",
        startsAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-04T00:00:00Z"),
        status: "scheduled" as const,
      },
      leaderboard: [],
    };
    const provider = new MockGolfProvider({ tournaments: [snapshot] });
    expect(await provider.fetchTournaments({ fromDate: "20260101", toDate: "20260101" })).toEqual([snapshot]);
  });
});
