import { z } from "zod";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { HttpError, withRetry, type RetryOptions } from "./retry.js";

/**
 * Adapter over ESPN's NFL *roster* endpoints — the same undocumented
 * site.api.espn.com family as sports-provider.ts and golf-provider.ts,
 * but a third distinct shape: this one describes PEOPLE, not events.
 * Nothing here touches the scoreboard, and nothing here writes a game.
 * It exists solely to fill the player pool the daily college quiz
 * draws from (docs/college-trivia.md).
 *
 * Two calls per run shape, not one: `/teams` for the 32 team ids, then
 * `/teams/{id}/roster` for each. Confirmed live against the real API —
 * the per-team roster response embeds the FULL athlete object
 * (`displayName`, `position`, `headshot`, AND `college`), so ~33
 * requests get the entire league. The obvious-looking alternative
 * (`sports.core.api.espn.com/.../athletes`) returns a page of `$ref`
 * URLs whose college has to be dereferenced one athlete at a time —
 * thousands of requests for the same data. Same reason golf-provider
 * uses the site API rather than the core one.
 *
 * Provider field names never cross the boundary out of this file —
 * everything else in the app only ever sees `CanonicalNflAthlete`.
 */

export type RosterStatus = "active" | "practice_squad" | "injured_reserve";

export interface CanonicalNflAthlete {
  externalId: string;
  displayName: string;
  positionAbbreviation: string | null;
  jersey: string | null;
  headshotUrl: string | null;
  teamExternalId: string;
  teamDisplayName: string;
  // Never null — an athlete ESPN gives no college for is dropped by
  // `mapRosterToAthletes` rather than surfaced with a null, because
  // "which college did this player attend?" has no answer for them.
  // This is the one field this whole adapter exists to fetch.
  collegeName: string;
  collegeExternalId: string | null;
  collegeLogoUrl: string | null;
  rosterStatus: RosterStatus;
  experienceYears: number | null;
}

export interface NflAthleteProvider {
  fetchAthletes(): Promise<CanonicalNflAthlete[]>;
}

// --- Raw ESPN response shapes (only the fields actually read) --------------

const espnTeamsResponseSchema = z.object({
  sports: z.array(
    z.object({
      leagues: z.array(
        z.object({
          teams: z.array(z.object({ team: z.object({ id: z.string() }) })),
        }),
      ),
    }),
  ),
});

const espnCollegeSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  logos: z.array(z.object({ href: z.string(), rel: z.array(z.string()).optional() })).optional(),
});

const espnRosterAthleteSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  jersey: z.string().optional(),
  // Absent for a handful of athletes (confirmed live: International
  // Player Pathway signings carry no `college` object at all). Optional
  // rather than required so ONE such player can't fail validation for
  // an entire 90-man roster — they're filtered out below instead.
  college: espnCollegeSchema.optional(),
  position: z.object({ abbreviation: z.string().optional() }).optional(),
  headshot: z.object({ href: z.string() }).optional(),
  experience: z.object({ years: z.number() }).optional(),
});

const espnRosterGroupSchema = z.object({
  position: z.string(),
  items: z.array(z.unknown()).default([]),
});

const espnRosterResponseSchema = z.object({
  team: z.object({ id: z.string(), displayName: z.string() }),
  athletes: z.array(espnRosterGroupSchema).default([]),
});

/**
 * ESPN's roster GROUP key -> our `roster_status`. The groups are
 * positional ("offense"/"defense"/"specialTeam") for everyone on the
 * active roster, and only become status-like for the two exceptions —
 * confirmed live: a real response carries exactly
 * offense/defense/specialTeam/injuredReserveOrOut/suspended/practiceSquad.
 * Anything unrecognized falls through to "active", which is the safe
 * direction: a mislabelled active player only affects question
 * WEIGHTING (lib/trivia-puzzle.ts), never correctness.
 */
function toRosterStatus(groupKey: string): RosterStatus {
  if (groupKey === "practiceSquad") return "practice_squad";
  if (groupKey === "injuredReserveOrOut") return "injured_reserve";
  return "active";
}

/** ESPN gives both a light and a `-dark` variant; take the default. */
function pickCollegeLogo(college: z.infer<typeof espnCollegeSchema>): string | null {
  const logos = college.logos ?? [];
  const preferred = logos.find((l) => l.rel?.includes("default")) ?? logos[0];
  return preferred?.href ?? null;
}

export function mapRosterToAthletes(roster: z.infer<typeof espnRosterResponseSchema>): CanonicalNflAthlete[] {
  const athletes: CanonicalNflAthlete[] = [];

  for (const group of roster.athletes) {
    for (const rawAthlete of group.items) {
      const parsed = espnRosterAthleteSchema.safeParse(rawAthlete);
      if (!parsed.success) {
        logger.warn({ teamId: roster.team.id }, "espn nfl roster: one athlete failed schema validation, skipping it");
        continue;
      }
      const a = parsed.data;

      // The deliberate drop, not an error: see CanonicalNflAthlete.
      if (!a.college?.name) continue;

      athletes.push({
        externalId: a.id,
        displayName: a.displayName,
        positionAbbreviation: a.position?.abbreviation ?? null,
        jersey: a.jersey ?? null,
        headshotUrl: a.headshot?.href ?? null,
        teamExternalId: roster.team.id,
        teamDisplayName: roster.team.displayName,
        collegeName: a.college.name,
        collegeExternalId: a.college.id ?? null,
        collegeLogoUrl: pickCollegeLogo(a.college),
        rosterStatus: toRosterStatus(group.position),
        experienceYears: a.experience?.years ?? null,
      });
    }
  }

  return athletes;
}

// --- Providers ---------------------------------------------------------------

/** Zero network calls — dev/CI never hit ESPN or need it reachable,
 * matching MockGolfProvider/MockSportsProvider exactly. */
export class MockNflAthleteProvider implements NflAthleteProvider {
  constructor(private readonly canned: CanonicalNflAthlete[] = []) {}

  async fetchAthletes(): Promise<CanonicalNflAthlete[]> {
    return this.canned;
  }
}

const ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export class EspnNflAthleteProvider implements NflAthleteProvider {
  constructor(
    private readonly baseUrl: string = ESPN_BASE_URL,
    private readonly retryOptions: RetryOptions = {},
  ) {}

  async fetchAthletes(): Promise<CanonicalNflAthlete[]> {
    const teamIds = await this.fetchTeamIds();
    const athletes: CanonicalNflAthlete[] = [];

    // Sequential, not Promise.all: 32 requests fired at once at an
    // undocumented free endpoint is exactly the shape that gets an
    // IP throttled, and this job runs on a weekly cron where latency
    // is worth nothing. Same restraint as schedule-ingest's per-sport
    // loop.
    for (const teamId of teamIds) {
      try {
        athletes.push(...(await this.fetchTeamRoster(teamId)));
      } catch (err) {
        // One unreachable team costs 1/32nd of the pool, not the whole
        // run — the pool is additive and upserted, so the previous
        // ingest's rows for that team survive untouched.
        logger.warn({ teamId, err }, "espn nfl roster: team fetch failed, continuing with the rest");
      }
    }

    return athletes;
  }

  private async fetchTeamIds(): Promise<string[]> {
    const rawJson: unknown = await withRetry(async () => {
      const url = `${this.baseUrl}/teams`;
      const res = await fetch(url);
      if (!res.ok) throw new HttpError(`ESPN NFL teams request failed: ${res.status} ${url}`, res.status);
      return res.json();
    }, this.retryOptions);

    const parsed = espnTeamsResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      logger.warn("espn nfl: teams response failed schema validation, treating as zero teams");
      return [];
    }

    return parsed.data.sports.flatMap((s) => s.leagues.flatMap((l) => l.teams.map((t) => t.team.id)));
  }

  private async fetchTeamRoster(teamId: string): Promise<CanonicalNflAthlete[]> {
    const rawJson: unknown = await withRetry(async () => {
      const url = `${this.baseUrl}/teams/${teamId}/roster`;
      const res = await fetch(url);
      if (!res.ok) throw new HttpError(`ESPN NFL roster request failed: ${res.status} ${url}`, res.status);
      return res.json();
    }, this.retryOptions);

    const parsed = espnRosterResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      logger.warn({ teamId }, "espn nfl: roster response failed schema validation, skipping team");
      return [];
    }

    return mapRosterToAthletes(parsed.data);
  }
}

/** Same `SPORTS_API_PROVIDER` toggle every other provider reads — one
 * "are we hitting real ESPN or not" switch for the whole app, not a
 * per-sport one. */
export function createNflAthleteProvider(override?: NflAthleteProvider): NflAthleteProvider {
  if (override) return override;
  if (env.SPORTS_API_PROVIDER === "mock") return new MockNflAthleteProvider();
  return new EspnNflAthleteProvider(env.ESPN_API_BASE_URL ? `${env.ESPN_API_BASE_URL}/football/nfl` : undefined);
}
