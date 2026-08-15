import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EspnNflAthleteProvider, MockNflAthleteProvider } from "./nfl-athlete-provider.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/espn");

// The fixture is a REAL, trimmed ESPN roster response (Kansas City,
// captured live) — including the one athlete ESPN gives no `college`
// object for at all, which is the whole reason that field is optional.
const rosterFixture: unknown = JSON.parse(readFileSync(join(fixturesDir, "nfl-roster.json"), "utf8"));

// A REAL, trimmed depth chart for the same team (captured live). Its
// wr2 slot lists Xavier Worthy first and Cyrus Allen second — both of
// whom are in the roster fixture, so the starter/backup distinction
// is exercised end to end.
const depthChartFixture: unknown = JSON.parse(readFileSync(join(fixturesDir, "nfl-depthchart.json"), "utf8"));

const teamsFixture = {
  sports: [{ leagues: [{ teams: [{ team: { id: "12" } }] }] }],
};

const instantSleep = async (_ms: number) => {};

function newProvider(): EspnNflAthleteProvider {
  return new EspnNflAthleteProvider(undefined, { sleepFn: instantSleep });
}

/** Answers the `/teams` call with the teams fixture, `/depthcharts`
 * with the depth chart fixture, and `/teams/:id/roster` with the
 * roster fixture. */
function stubEspn(roster: unknown = rosterFixture, teams: unknown = teamsFixture, depthChart: unknown = depthChartFixture) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes("/depthcharts") ? depthChart : url.includes("/roster") ? roster : teams),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MockNflAthleteProvider", () => {
  it("makes no network call at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await new MockNflAthleteProvider().fetchAthletes();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns whatever it was constructed with", async () => {
    const canned = await new MockNflAthleteProvider([
      {
        externalId: "1",
        displayName: "Test Player",
        positionAbbreviation: "QB",
        jersey: "1",
        headshotUrl: null,
        teamExternalId: "1",
        teamDisplayName: "Test Team",
        collegeName: "Alabama",
        collegeExternalId: null,
        collegeLogoUrl: null,
        rosterStatus: "active",
        experienceYears: 3,
        isStarter: true,
      },
    ]).fetchAthletes();

    expect(canned).toHaveLength(1);
    expect(canned[0]!.collegeName).toBe("Alabama");
  });
});

describe("EspnNflAthleteProvider", () => {
  it("maps a real roster response to canonical athletes", async () => {
    stubEspn();

    const athletes = await newProvider().fetchAthletes();

    const cyrus = athletes.find((a) => a.displayName === "Cyrus Allen");
    expect(cyrus).toMatchObject({
      externalId: "4912218",
      collegeName: "Cincinnati",
      collegeExternalId: "2132",
      positionAbbreviation: "WR",
      jersey: "13",
      teamDisplayName: "Kansas City Chiefs",
      rosterStatus: "active",
      experienceYears: 0,
    });
    expect(cyrus!.headshotUrl).toContain("headshots/nfl");
  });

  it("flags an athlete listed first in a depth-chart slot as a starter, and one listed second as not", async () => {
    stubEspn();

    const athletes = await newProvider().fetchAthletes();

    // wr2 in the depth chart fixture: Worthy first, Allen second.
    expect(athletes.find((a) => a.displayName === "Xavier Worthy")!.isStarter).toBe(true);
    expect(athletes.find((a) => a.displayName === "Cyrus Allen")!.isStarter).toBe(false);
  });

  it("marks a whole team's starter flags UNKNOWN (null), not false, when the depth chart is unreachable", async () => {
    // Demoting every starter on a team to a backup because one
    // optional request failed would quietly degrade the quiz for a
    // week — null lets the ingest keep the values it already has.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/depthcharts")) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => (url.includes("/roster") ? rosterFixture : teamsFixture) };
      }),
    );

    const athletes = await newProvider().fetchAthletes();

    expect(athletes.length).toBeGreaterThan(0);
    expect(athletes.every((a) => a.isStarter === null)).toBe(true);
  });

  it("treats a depth chart that changed shape like an unreachable one", async () => {
    stubEspn(rosterFixture, teamsFixture, { unexpected: "shape" });

    const athletes = await newProvider().fetchAthletes();

    expect(athletes.length).toBeGreaterThan(0);
    expect(athletes.every((a) => a.isStarter === null)).toBe(true);
  });

  it("DROPS an athlete ESPN gives no college for, rather than storing a null", async () => {
    stubEspn();

    const athletes = await newProvider().fetchAthletes();

    // Confirmed live: this player really has no `college` object.
    // A college-trivia question about him would be unanswerable.
    expect(athletes.map((a) => a.displayName)).not.toContain("Chukwuebuka Godrick");
    expect(athletes.every((a) => Boolean(a.collegeName))).toBe(true);
  });

  it("normalizes ESPN's roster GROUP into a roster status", async () => {
    stubEspn();

    const athletes = await newProvider().fetchAthletes();

    // "offense"/"defense"/"specialTeam" are positional, not status —
    // they all mean "on the active roster".
    expect(athletes.find((a) => a.displayName === "Cyrus Allen")!.rosterStatus).toBe("active");
    // "injuredReserveOrOut" is the one that genuinely IS a status.
    expect(athletes.find((a) => a.displayName === "Ethan Downs")!.rosterStatus).toBe("injured_reserve");
  });

  it("picks the light college logo, not the -dark variant", async () => {
    stubEspn();

    const athletes = await newProvider().fetchAthletes();

    const cyrus = athletes.find((a) => a.displayName === "Cyrus Allen");
    expect(cyrus!.collegeLogoUrl).toBe("https://a.espncdn.com/i/teamlogos/ncaa/500/2132.png");
  });

  it("returns zero athletes rather than throwing when the teams response changes shape", async () => {
    stubEspn(rosterFixture, { unexpected: "shape" });

    await expect(newProvider().fetchAthletes()).resolves.toEqual([]);
  });

  it("skips one unreachable team instead of failing the whole run", async () => {
    // The pool is additive and upserted, so losing 1/32nd of it for a
    // run costs nothing — failing the run would cost the refresh.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/roster")) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => teamsFixture };
      }),
    );

    await expect(newProvider().fetchAthletes()).resolves.toEqual([]);
  });

  it("skips a malformed roster rather than throwing", async () => {
    stubEspn({ team: { id: "12", displayName: "Test" }, athletes: [{ position: "offense", items: [{ junk: true }] }] });

    await expect(newProvider().fetchAthletes()).resolves.toEqual([]);
  });
});
