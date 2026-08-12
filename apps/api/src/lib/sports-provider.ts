import { z } from "zod";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { HttpError, withRetry, type RetryOptions } from "./retry.js";

/**
 * Adapter over ESPN's undocumented site.api.espn.com scoreboard API —
 * see docs/adr/0003-sports-data-pipeline.md for why ESPN, and
 * docs/sports-pipeline.md for the edge-case behavior this maps to.
 * Provider field names (ESPN's `homeAway`, `STATUS_FINAL`, etc.) NEVER
 * cross the boundary out of this file — everything else in the app
 * only ever sees the Canonical* types below.
 */

export type CanonicalGameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";

export interface CanonicalTeam {
  externalId: string;
  displayName: string; // works for both "Toronto Raptors" and single-word "Arsenal"
}

export interface CanonicalScheduleEntry {
  externalId: string;
  sport: string; // nfl|ncaaf|nba|ncaamb|mlb|epl|ucl|mls
  startsAt: Date;
  status: CanonicalGameStatus;
  homeTeam: CanonicalTeam;
  awayTeam: CanonicalTeam;
  allowsDraw: boolean;
}

export interface CanonicalResult {
  externalId: string;
  status: CanonicalGameStatus;
  // A side, not a team-name string — the caller (score-poll) resolves
  // 'home'/'away' against its own already-stored game.home_team/away_team
  // text, so this adapter never needs its team-name string to exactly
  // match what's already in the database.
  winnerSide: "home" | "away" | "draw" | null; // non-null only when status === 'final'
}

export interface FetchScheduleParams {
  sport: string;
  fromDate: string; // YYYYMMDD
  toDate: string; // YYYYMMDD
}

export interface FetchResultsParams {
  externalId: string;
  sport: string;
  date: string; // YYYYMMDD of the game's known starts_at
}

export interface SportsProvider {
  fetchSchedule(params: FetchScheduleParams): Promise<CanonicalScheduleEntry[]>;
  fetchResults(games: FetchResultsParams[]): Promise<CanonicalResult[]>;
}

/**
 * Sport code -> ESPN URL slug + draw eligibility. Single source of
 * truth: schedule-ingest reads this to know which 8 codes to loop, and
 * to stamp game.allows_draw — no sport-code knowledge is duplicated
 * anywhere else (not even in SQL — see the pick-validation trigger,
 * which reads game.allows_draw rather than hardcoding a sport list).
 */
export const ESPN_SPORT_SLUGS: Record<string, { espnSport: string; espnLeague: string; allowsDraw: boolean }> = {
  nfl: { espnSport: "football", espnLeague: "nfl", allowsDraw: false },
  ncaaf: { espnSport: "football", espnLeague: "college-football", allowsDraw: false },
  nba: { espnSport: "basketball", espnLeague: "nba", allowsDraw: false },
  ncaamb: { espnSport: "basketball", espnLeague: "mens-college-basketball", allowsDraw: false },
  mlb: { espnSport: "baseball", espnLeague: "mlb", allowsDraw: false },
  epl: { espnSport: "soccer", espnLeague: "eng.1", allowsDraw: true },
  ucl: { espnSport: "soccer", espnLeague: "uefa.champions", allowsDraw: true },
  mls: { espnSport: "soccer", espnLeague: "usa.1", allowsDraw: true },
};

// --- Raw ESPN response shape (only the fields actually read) ---------------

const espnStatusTypeSchema = z.object({
  completed: z.boolean(),
  state: z.string(),
  name: z.string(),
});

const espnTeamSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

const espnCompetitorSchema = z.object({
  homeAway: z.enum(["home", "away"]),
  // Absent (not `false`) on pre-game events — confirmed against a real
  // captured ESPN response for a not-yet-started game. Optional here,
  // and every read-site treats "not exactly true" as "not the winner"
  // (`c.winner` truthiness check), so undefined behaves the same as
  // false without needing special-casing.
  winner: z.boolean().optional(),
  team: espnTeamSchema,
});

const espnCompetitionSchema = z.object({
  competitors: z.array(espnCompetitorSchema).length(2),
  status: z.object({ type: espnStatusTypeSchema }),
});

const espnEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  competitions: z.array(espnCompetitionSchema).min(1),
});

type EspnEvent = z.infer<typeof espnEventSchema>;

const espnScoreboardResponseSchema = z.object({
  events: z.array(z.unknown()).default([]),
});

// --- Finality mapping — structurally the only path to 'final' --------------

/**
 * completed === true is the ONLY authoritative "this game is final"
 * signal, and it's the same field across every sport ESPN covers.
 * status.type.name varies by sport for the same real-world state
 * (STATUS_FINAL for NFL/MLB/NCAAF, STATUS_FULL_TIME for soccer regular
 * play, STATUS_FINAL_PEN for soccer decided on penalties — all three
 * confirmed against real ESPN responses) — never string-match `name`
 * to decide finality. Anything unrecognized returns null so the caller
 * can log-and-skip that one event rather than crash or guess.
 */
export function toCanonicalStatus(statusType: {
  completed: boolean;
  state: string;
  name: string;
}): CanonicalGameStatus | null {
  if (statusType.completed === true) return "final";
  if (statusType.state === "pre") return "scheduled";
  if (statusType.state === "in") return "in_progress";
  if (statusType.name === "STATUS_POSTPONED" || statusType.name === "STATUS_SUSPENDED") return "postponed";
  if (statusType.name === "STATUS_CANCELED") return "canceled";
  return null;
}

function mapEventToScheduleEntry(
  event: EspnEvent,
  sport: string,
  allowsDraw: boolean,
): CanonicalScheduleEntry | null {
  const competition = event.competitions[0]!;
  const status = toCanonicalStatus(competition.status.type);
  if (status === null) {
    logger.warn({ eventId: event.id, statusName: competition.status.type.name }, "espn: unrecognized status, skipping event");
    return null;
  }

  const home = competition.competitors.find((c) => c.homeAway === "home");
  const away = competition.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) {
    logger.warn({ eventId: event.id }, "espn: event missing home/away competitor, skipping");
    return null;
  }

  return {
    externalId: event.id,
    sport,
    startsAt: new Date(event.date),
    status,
    homeTeam: { externalId: home.team.id, displayName: home.team.displayName },
    awayTeam: { externalId: away.team.id, displayName: away.team.displayName },
    allowsDraw,
  };
}

function mapEventToResult(event: EspnEvent): CanonicalResult | null {
  const competition = event.competitions[0]!;
  const status = toCanonicalStatus(competition.status.type);
  if (status === null) {
    logger.warn({ eventId: event.id, statusName: competition.status.type.name }, "espn: unrecognized status, skipping event");
    return null;
  }

  let winnerSide: CanonicalResult["winnerSide"] = null;
  if (status === "final") {
    const home = competition.competitors.find((c) => c.homeAway === "home");
    const away = competition.competitors.find((c) => c.homeAway === "away");
    if (home?.winner) winnerSide = "home";
    else if (away?.winner) winnerSide = "away";
    else winnerSide = "draw"; // completed, nobody's `winner` is true — a genuine draw
  }

  return { externalId: event.id, status, winnerSide };
}

// --- In-run circuit breaker -------------------------------------------------

export class EspnCircuitOpenError extends Error {
  constructor() {
    super("ESPN circuit breaker open — too many consecutive failures this run");
  }
}

/**
 * Fresh per EspnSportsProvider instance, which is fresh per job
 * invocation (each cron run is a new process) — tripping it fails the
 * current run fast rather than burning the whole run's time budget on
 * a provider that's clearly down; the next cron tick starts clean. No
 * sustained-load model needed since there's no long-running process to
 * protect here.
 */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private tripped = false;
  constructor(private readonly threshold = 3) {}

  guard(): void {
    if (this.tripped) throw new EspnCircuitOpenError();
  }
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) this.tripped = true;
  }
}

// --- Providers ---------------------------------------------------------------

/** Zero network calls — dev/CI never hit ESPN or need it reachable. */
export class MockSportsProvider implements SportsProvider {
  constructor(
    private readonly canned: { schedule?: CanonicalScheduleEntry[]; results?: CanonicalResult[] } = {},
  ) {}

  async fetchSchedule(_params: FetchScheduleParams): Promise<CanonicalScheduleEntry[]> {
    return this.canned.schedule ?? [];
  }

  async fetchResults(games: FetchResultsParams[]): Promise<CanonicalResult[]> {
    const requested = new Set(games.map((g) => g.externalId));
    return (this.canned.results ?? []).filter((r) => requested.has(r.externalId));
  }
}

const ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports";

/** YYYYMMDD, the date format ESPN's `dates=` query param expects —
 * exported since both scheduled jobs need to build FetchSchedule/
 * FetchResultsParams from a JS Date. */
export function toYyyyMmDd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** date-1 to date+1, both YYYYMMDD — see fetchResults for why this is a
 * range and not the exact date. */
function threeDayRange(yyyymmdd: string): { fromDate: string; toDate: string } {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  const center = new Date(Date.UTC(year, month, day));
  const from = new Date(center);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(center);
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromDate: toYyyyMmDd(from), toDate: toYyyyMmDd(to) };
}

export class EspnSportsProvider implements SportsProvider {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly baseUrl: string = ESPN_BASE_URL,
    // Exposed for tests — real requests use withRetry's real defaults
    // (500ms base delay); tests inject a fast/instant sleepFn so retry
    // and circuit-breaker behavior can be exercised without real delays.
    private readonly retryOptions: RetryOptions = {},
  ) {}

  async fetchSchedule(params: FetchScheduleParams): Promise<CanonicalScheduleEntry[]> {
    const slug = ESPN_SPORT_SLUGS[params.sport];
    if (!slug) throw new Error(`Unknown sport code: ${params.sport}`);

    const datesParam = params.fromDate === params.toDate ? params.fromDate : `${params.fromDate}-${params.toDate}`;
    const events = await this.fetchScoreboard(slug.espnSport, slug.espnLeague, datesParam);

    const entries: CanonicalScheduleEntry[] = [];
    for (const event of events) {
      const entry = mapEventToScheduleEntry(event, params.sport, slug.allowsDraw);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async fetchResults(games: FetchResultsParams[]): Promise<CanonicalResult[]> {
    // Group by (sport, date) so many candidate games cost only a
    // handful of HTTP calls, not one per game.
    const groups = new Map<string, { sport: string; date: string; externalIds: Set<string> }>();
    for (const g of games) {
      const key = `${g.sport}|${g.date}`;
      let group = groups.get(key);
      if (!group) {
        group = { sport: g.sport, date: g.date, externalIds: new Set() };
        groups.set(key, group);
      }
      group.externalIds.add(g.externalId);
    }

    const results: CanonicalResult[] = [];
    for (const { sport, date, externalIds } of groups.values()) {
      const slug = ESPN_SPORT_SLUGS[sport];
      if (!slug) continue;

      // A 3-day range, not the exact date: ESPN's `dates=` bucketing
      // isn't guaranteed to match the UTC calendar day of a late-night
      // US game's `event.date` — querying a day on either side removes
      // the risk of silently missing it entirely.
      const { fromDate, toDate } = threeDayRange(date);
      const events = await this.fetchScoreboard(slug.espnSport, slug.espnLeague, `${fromDate}-${toDate}`);

      for (const event of events) {
        if (!externalIds.has(event.id)) continue;
        const result = mapEventToResult(event);
        if (result) results.push(result);
      }
    }
    return results;
  }

  private async fetchScoreboard(espnSport: string, espnLeague: string, datesParam: string): Promise<EspnEvent[]> {
    this.breaker.guard();

    let rawJson: unknown;
    try {
      rawJson = await withRetry(async () => {
        const url = `${this.baseUrl}/${espnSport}/${espnLeague}/scoreboard?dates=${datesParam}`;
        const res = await fetch(url);
        if (!res.ok) throw new HttpError(`ESPN request failed: ${res.status} ${url}`, res.status);
        return res.json();
      }, this.retryOptions);
      this.breaker.recordSuccess();
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }

    const parsed = espnScoreboardResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      // Not retried — retrying a fetch that already succeeded but
      // returned a shape we can't parse won't produce a different
      // shape. Treated as zero usable events, not a thrown failure —
      // the caller's own emptiness alerting (JAC-24) is what should
      // catch a systemic problem like ESPN changing their response shape.
      logger.warn({ espnSport, espnLeague }, "espn: scoreboard response failed schema validation, treating as zero events");
      return [];
    }

    const events: EspnEvent[] = [];
    for (const rawEvent of parsed.data.events) {
      const eventParsed = espnEventSchema.safeParse(rawEvent);
      if (eventParsed.success) {
        events.push(eventParsed.data);
      } else {
        logger.warn({ espnSport, espnLeague }, "espn: one event failed schema validation, skipping it");
      }
    }
    return events;
  }
}

/** Pass an override for tests that need hand-crafted schedule/result
 * scenarios; otherwise reads env.SPORTS_API_PROVIDER. */
export function createSportsProvider(override?: SportsProvider): SportsProvider {
  if (override) return override;
  if (env.SPORTS_API_PROVIDER === "mock") return new MockSportsProvider();
  return new EspnSportsProvider(env.ESPN_API_BASE_URL);
}
