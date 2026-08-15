import { z } from "zod";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { HttpError, withRetry, type RetryOptions } from "./retry.js";
import { toCanonicalStatus, type CanonicalGameStatus } from "./sports-provider.js";

/**
 * Adapter over ESPN's golf/pga scoreboard endpoint — same undocumented
 * site.api.espn.com family as sports-provider.ts, but genuinely a
 * different shape: one event IS one tournament (not a 2-sided match),
 * and its ~69 `competitors` share a single leaderboard via `order`
 * (1 = leader), not a home/away pair. See docs/sports-pipeline.md.
 *
 * Confirmed live: no separate cut/withdrawn marker exists anywhere in
 * the response — `order` is the only position signal ESPN exposes.
 * A withdrawn golfer's fate (whether ESPN keeps reordering them or
 * freezes their last position) hasn't been observed live and isn't
 * special-cased here — see golf-grading.ts for how this is handled at
 * the grading boundary instead of here.
 */

export interface CanonicalTournament {
  externalId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  status: CanonicalGameStatus;
}

export interface CanonicalLeaderboardEntry {
  externalId: string;
  golferName: string;
  // ESPN's `athlete.flag.href` — a country-flag CDN URL, the only image
  // an individual competitor has. Null when the provider omits it, in
  // which case the leaderboard renders name-only.
  flagUrl: string | null;
  // Null until the provider posts a score (tournament not yet under
  // way, or a golfer who hasn't teed off in the current round yet).
  position: number | null;
}

export interface CanonicalTournamentSnapshot {
  tournament: CanonicalTournament;
  leaderboard: CanonicalLeaderboardEntry[];
}

export interface FetchTournamentsParams {
  fromDate: string; // YYYYMMDD
  toDate: string; // YYYYMMDD
}

export interface GolfProvider {
  // One call returns both the tournament record and its current
  // leaderboard together, since ESPN's own scoreboard response always
  // bundles them — this is what lets jobs/golf-ingest.ts do discovery
  // and live-leaderboard polling as a single job instead of two.
  fetchTournaments(params: FetchTournamentsParams): Promise<CanonicalTournamentSnapshot[]>;
}

// --- Raw ESPN response shape (only the fields actually read) ---------------

const espnStatusTypeSchema = z.object({
  completed: z.boolean(),
  state: z.string(),
  name: z.string(),
});

const espnGolferSchema = z.object({
  displayName: z.string(),
  // Same `{ href, alt, rel: ["country-flag"] }` object the team-sport
  // adapter reads off an MMA/tennis athlete (confirmed live for
  // golf/pga too). Optional so a missing image degrades to a
  // name-only leaderboard row rather than failing the ingest.
  flag: z.object({ href: z.string() }).optional(),
});

const espnGolfCompetitorSchema = z.object({
  id: z.string(),
  // Direct leaderboard rank (1 = leader). Optional/absent pre-tournament
  // (confirmed live: not present before a golfer's first round starts).
  order: z.number().optional(),
  athlete: espnGolferSchema,
});

const espnGolfCompetitionSchema = z.object({
  // Optional, not required: an upcoming tournament's competition object
  // has NO `competitors` key at all until the field is announced
  // (confirmed live — next week's BMW Championship and the week after's
  // TOUR Championship both omit it entirely while the current event
  // carries all 69). Requiring it would fail validation on exactly the
  // tournaments members most need to see, since picks must be made
  // BEFORE a tournament starts.
  competitors: z.array(espnGolfCompetitorSchema).optional(),
});

const espnGolfEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  endDate: z.string(),
  status: z.object({ type: espnStatusTypeSchema }),
  competitions: z.array(espnGolfCompetitionSchema).min(1),
});

type EspnGolfEvent = z.infer<typeof espnGolfEventSchema>;

const espnScoreboardResponseSchema = z.object({
  events: z.array(z.unknown()).default([]),
});

function mapEventToSnapshot(event: EspnGolfEvent): CanonicalTournamentSnapshot | null {
  const status = toCanonicalStatus(event.status.type);
  if (status === null) {
    logger.warn({ eventId: event.id, statusName: event.status.type.name }, "espn golf: unrecognized status, skipping event");
    return null;
  }

  const competitors = event.competitions[0]?.competitors ?? [];
  // An empty field is normal for an upcoming tournament, not an error —
  // the tournament row still gets written so it's visible and pickable
  // as soon as ESPN publishes the field.
  return {
    tournament: {
      externalId: event.id,
      name: event.name,
      startsAt: new Date(event.date),
      endsAt: new Date(event.endDate),
      status,
    },
    leaderboard: competitors.map((c) => ({
      externalId: c.id,
      golferName: c.athlete.displayName,
      flagUrl: c.athlete.flag?.href ?? null,
      position: c.order ?? null,
    })),
  };
}

// --- Providers ---------------------------------------------------------------

/** Zero network calls — dev/CI never hit ESPN or need it reachable. */
export class MockGolfProvider implements GolfProvider {
  constructor(private readonly canned: { tournaments?: CanonicalTournamentSnapshot[] } = {}) {}

  async fetchTournaments(_params: FetchTournamentsParams): Promise<CanonicalTournamentSnapshot[]> {
    return this.canned.tournaments ?? [];
  }
}

const ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/golf/pga";

export class EspnGolfProvider implements GolfProvider {
  constructor(
    private readonly baseUrl: string = ESPN_BASE_URL,
    private readonly retryOptions: RetryOptions = {},
  ) {}

  async fetchTournaments(params: FetchTournamentsParams): Promise<CanonicalTournamentSnapshot[]> {
    const datesParam = params.fromDate === params.toDate ? params.fromDate : `${params.fromDate}-${params.toDate}`;

    const rawJson: unknown = await withRetry(async () => {
      const url = `${this.baseUrl}/scoreboard?dates=${datesParam}`;
      const res = await fetch(url);
      if (!res.ok) throw new HttpError(`ESPN golf request failed: ${res.status} ${url}`, res.status);
      return res.json();
    }, this.retryOptions);

    const parsed = espnScoreboardResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      logger.warn("espn golf: scoreboard response failed schema validation, treating as zero events");
      return [];
    }

    const snapshots: CanonicalTournamentSnapshot[] = [];
    for (const rawEvent of parsed.data.events) {
      const eventParsed = espnGolfEventSchema.safeParse(rawEvent);
      if (!eventParsed.success) {
        logger.warn("espn golf: one event failed schema validation, skipping it");
        continue;
      }
      const snapshot = mapEventToSnapshot(eventParsed.data);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }
}

/** Pass an override for tests that need hand-crafted tournament
 * scenarios; otherwise reads env.SPORTS_API_PROVIDER — same env var as
 * createSportsProvider, since it's one "are we hitting real ESPN or
 * not" toggle for the whole app, not a per-sport one. */
export function createGolfProvider(override?: GolfProvider): GolfProvider {
  if (override) return override;
  if (env.SPORTS_API_PROVIDER === "mock") return new MockGolfProvider();
  return new EspnGolfProvider(env.ESPN_API_BASE_URL ? `${env.ESPN_API_BASE_URL}/golf/pga` : undefined);
}
