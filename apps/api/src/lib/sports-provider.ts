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
  // ESPN's `team.logo` — confirmed present as a plain CDN URL string
  // across every tracked sport (NFL/NBA/MLB/soccer) against the live
  // API. Optional/null rather than required: a provider swap or a
  // future ESPN response shape change shouldn't be able to break
  // schedule ingestion just because an image URL went missing.
  logoUrl: string | null;
  // ESPN's `team.color` — 6-digit hex, no leading '#' (e.g. "0e3386"),
  // confirmed present alongside `logo` across every tracked sport
  // against the live API. Same optional/null reasoning as logoUrl.
  color: string | null;
  // ESPN's `athlete.flag.href` — the individual sports' stand-in for a
  // crest. Mutually exclusive with `logoUrl` in practice: a competitor
  // is either a franchise (logo, color) or a person (flag), never both.
  // Same optional/null reasoning as the two fields above.
  flagUrl: string | null;
}

export interface CanonicalScheduleEntry {
  externalId: string;
  sport: string; // nfl|ncaaf|nba|ncaamb|mlb|nhl|epl|ucl|mls
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
 * truth: schedule-ingest reads this to know which 9 codes to loop, and
 * to stamp game.allows_draw — no sport-code knowledge is duplicated
 * anywhere else (not even in SQL — see the pick-validation trigger,
 * which reads game.allows_draw rather than hardcoding a sport list).
 *
 * NHL confirmed structurally identical to the other team sports here
 * (exactly 2 competitors per event, each with homeAway + a team
 * object) against the live API — a genuine drop-in.
 *
 * Tennis and MMA are genuinely individual sports (no "team"), but each
 * MATCH/fight is still a real 2-competitor head-to-head, same as
 * every sport above — just packaged differently by ESPN:
 *   - "individual-grouped" (tennis): one ESPN "event" is an entire
 *     ~2-week TOURNAMENT, not a match. Real matches live nested under
 *     event.groupings[].competitions[] — one grouping per draw
 *     (Men's Singles, Women's Singles, Men's Doubles, ...). Doubles
 *     groupings are deliberately excluded (a doubles "competitor" is
 *     a pair, not a single participant — out of scope); singles
 *     matches genuinely have `homeAway` on each competitor, same as
 *     a team sport. `tennis/atp`'s scoreboard already includes BOTH
 *     tours' singles draws for a combined event week (confirmed live:
 *     `tennis/atp` and `tennis/wta` return the identical "Cincinnati
 *     Open" event with both Men's and Women's groupings on either
 *     slug) — hitting both would double-ingest the same matches, so
 *     only `atp` is queried, and the app-level sport code is the
 *     gender-neutral `tennis`, not `atp`.
 *   - "individual-flat" (MMA): one ESPN "event" is a whole fight CARD
 *     (e.g. "UFC 330"), and event.competitions[] already holds EVERY
 *     fight on that card directly (no extra nesting) — but each
 *     fight's own `id`/`date`/`status` live on the competition, not
 *     the event (a card's fights don't share one start time).
 *     Competitors carry no `homeAway` field at all, only `order`
 *     (1/2) — synthesized into home/away below, arbitrarily but
 *     consistently, the same way this whole app treats home/away as
 *     "two distinguishable sides to pick between", never a meaningful
 *     home-field signal in its own right.
 *
 * Golf is NOT included: a PGA event has ~69 athlete competitors in
 * one shared leaderboard, not a 2-competitor matchup at all — it
 * doesn't fit this adapter's shape (or this app's pick-a-side model)
 * no matter how the raw shape is reprocessed.
 */
type MatchStyle = "team" | "individual-flat" | "individual-grouped";

export const ESPN_SPORT_SLUGS: Record<
  string,
  { espnSport: string; espnLeague: string; allowsDraw: boolean; matchStyle: MatchStyle }
> = {
  nfl: { espnSport: "football", espnLeague: "nfl", allowsDraw: false, matchStyle: "team" },
  ncaaf: { espnSport: "football", espnLeague: "college-football", allowsDraw: false, matchStyle: "team" },
  nba: { espnSport: "basketball", espnLeague: "nba", allowsDraw: false, matchStyle: "team" },
  ncaamb: {
    espnSport: "basketball",
    espnLeague: "mens-college-basketball",
    allowsDraw: false,
    matchStyle: "team",
  },
  mlb: { espnSport: "baseball", espnLeague: "mlb", allowsDraw: false, matchStyle: "team" },
  nhl: { espnSport: "hockey", espnLeague: "nhl", allowsDraw: false, matchStyle: "team" },
  epl: { espnSport: "soccer", espnLeague: "eng.1", allowsDraw: true, matchStyle: "team" },
  ucl: { espnSport: "soccer", espnLeague: "uefa.champions", allowsDraw: true, matchStyle: "team" },
  mls: { espnSport: "soccer", espnLeague: "usa.1", allowsDraw: true, matchStyle: "team" },
  tennis: { espnSport: "tennis", espnLeague: "atp", allowsDraw: false, matchStyle: "individual-grouped" },
  mma: { espnSport: "mma", espnLeague: "ufc", allowsDraw: false, matchStyle: "individual-flat" },
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
  logo: z.string().optional(),
  color: z.string().optional(),
});

// Individual sports (tennis/MMA) carry an `athlete` object instead of
// `team` — same "who is this side" question, different ESPN field
// name. A competitor's own top-level `id` (below) already works as a
// stable external ID for both shapes, so no id is read here.
const espnAthleteSchema = z.object({
  displayName: z.string(),
  // The athlete-side counterpart to `team.logo`: ESPN returns
  // `{ href, alt, rel: ["country-flag"] }` here (confirmed live for
  // mma/ufc and tennis/atp). Optional for the same reason `team.logo`
  // is — a missing image must degrade to a text-only side, never fail
  // the whole schedule ingest. Only `href` is kept: the side's own
  // label already announces the competitor by name, so the flag renders
  // decoratively and has no use for `alt`'s country string.
  flag: z.object({ href: z.string() }).optional(),
});

const espnCompetitorSchema = z.object({
  id: z.string(),
  // Present on every team-sport competitor; ABSENT (not a third enum
  // value) on MMA competitors, which carry `order` instead — see
  // ESPN_SPORT_SLUGS's "individual-flat" doc comment for how that's
  // synthesized into home/away.
  homeAway: z.enum(["home", "away"]).optional(),
  order: z.number().optional(),
  // Absent (not `false`) on pre-game events — confirmed against a real
  // captured ESPN response for a not-yet-started game. Optional here,
  // and every read-site treats "not exactly true" as "not the winner"
  // (`c.winner` truthiness check), so undefined behaves the same as
  // false without needing special-casing.
  winner: z.boolean().optional(),
  team: espnTeamSchema.optional(),
  athlete: espnAthleteSchema.optional(),
});

const espnCompetitionSchema = z.object({
  // A single MATCH's own identity — for team sports this is identical
  // to the parent event's id/date (confirmed live: NFL/MLB/etc. always
  // have exactly one competition per event, sharing the event's own
  // id/date exactly), so reading it here uniformly costs team sports
  // nothing while being the ONLY correct source for MMA (many fights,
  // many start times, one shared event/card) and tennis (a match's own
  // id/date, nested under groupings — the event itself is the whole
  // tournament, not a match).
  id: z.string(),
  date: z.string(),
  competitors: z.array(espnCompetitorSchema).length(2),
  status: z.object({ type: espnStatusTypeSchema }),
});

type EspnCompetition = z.infer<typeof espnCompetitionSchema>;

// Tennis-only: one grouping per draw (Men's Singles, Women's Singles,
// Men's Doubles, Women's Doubles, ...) — see ESPN_SPORT_SLUGS's
// "individual-grouped" doc comment for why only singles are read.
const espnGroupingSchema = z.object({
  grouping: z.object({ displayName: z.string() }),
  competitions: z.array(espnCompetitionSchema),
});

const espnEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  // Optional, not required: a tennis "event" (a whole tournament) has
  // NO `competitions` field at all, only `groupings` — confirmed live.
  // Team sports and MMA have `competitions` but no `groupings`.
  competitions: z.array(espnCompetitionSchema).optional(),
  groupings: z.array(espnGroupingSchema).optional(),
});

type EspnEvent = z.infer<typeof espnEventSchema>;

const espnScoreboardResponseSchema = z.object({
  events: z.array(z.unknown()).default([]),
});

/** Flattens one ESPN event down to its real, individually-startable
 * matches — see ESPN_SPORT_SLUGS's per-matchStyle doc comments for
 * why this differs by sport. Every other function in this file
 * operates on the resulting EspnCompetition, never the raw event,
 * past this point. */
function extractMatches(event: EspnEvent, matchStyle: MatchStyle): EspnCompetition[] {
  if (matchStyle === "individual-grouped") {
    return (event.groupings ?? [])
      .filter((g) => /singles/i.test(g.grouping.displayName))
      .flatMap((g) => g.competitions);
  }
  return event.competitions ?? [];
}

/** `c.homeAway` when present (every team sport, and tennis); MMA has
 * no such field at all, only `order` — order 1 becomes "home", order
 * 2 (or anything else) becomes "away". Arbitrary but consistent, and
 * no different in kind from every other sport here: home/away is
 * never read as a meaningful home-field signal anywhere in this app,
 * only as "two distinguishable sides to pick between" (see
 * CanonicalResult's own doc comment on winnerSide). */
function sideOf(competitor: { homeAway?: "home" | "away"; order?: number }, fallbackIndex: number): "home" | "away" {
  if (competitor.homeAway) return competitor.homeAway;
  return (competitor.order ?? fallbackIndex + 1) === 1 ? "home" : "away";
}

function participantOf(competitor: {
  id: string;
  team?: { id: string; displayName: string; logo?: string; color?: string };
  athlete?: { displayName: string; flag?: { href: string } };
}): CanonicalTeam | null {
  const displayName = competitor.team?.displayName ?? competitor.athlete?.displayName;
  if (!displayName) return null;
  return {
    // Prefer the TEAM's own id for team sports — that's the stable
    // per-franchise join key `game.home_team_external_id` has always
    // held, and changing it would orphan existing rows. Individual
    // sports have no team object, so the competitor's own id (which is
    // the athlete's id there) is the only stable identifier available.
    externalId: competitor.team?.id ?? competitor.id,
    displayName,
    // Only teams carry these — an athlete competitor (tennis/MMA) has
    // no crest or team color, so both stay null rather than being
    // faked from something unrelated.
    logoUrl: competitor.team?.logo ?? null,
    color: competitor.team?.color ?? null,
    // …and only athletes carry this one. Read off `athlete` alone, not
    // coalesced into `logoUrl`, so the two stay independently
    // inspectable downstream (see 0014_athlete_country_flags.sql).
    flagUrl: competitor.athlete?.flag?.href ?? null,
  };
}

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

function mapMatchToScheduleEntry(
  match: EspnCompetition,
  sport: string,
  allowsDraw: boolean,
): CanonicalScheduleEntry | null {
  const status = toCanonicalStatus(match.status.type);
  if (status === null) {
    logger.warn({ matchId: match.id, statusName: match.status.type.name }, "espn: unrecognized status, skipping match");
    return null;
  }

  const homeC = match.competitors.find((c, i) => sideOf(c, i) === "home");
  const awayC = match.competitors.find((c, i) => sideOf(c, i) === "away");
  const home = homeC && participantOf(homeC);
  const away = awayC && participantOf(awayC);
  if (!home || !away) {
    logger.warn({ matchId: match.id }, "espn: match missing home/away participant, skipping");
    return null;
  }

  return {
    externalId: match.id,
    sport,
    startsAt: new Date(match.date),
    status,
    // participantOf() already produced a complete CanonicalTeam
    // (including logoUrl/color for team sports) — see its comment for
    // why individual sports leave those null.
    homeTeam: home,
    awayTeam: away,
    allowsDraw,
  };
}

function mapMatchToResult(match: EspnCompetition): CanonicalResult | null {
  const status = toCanonicalStatus(match.status.type);
  if (status === null) {
    logger.warn({ matchId: match.id, statusName: match.status.type.name }, "espn: unrecognized status, skipping match");
    return null;
  }

  let winnerSide: CanonicalResult["winnerSide"] = null;
  if (status === "final") {
    const home = match.competitors.find((c, i) => sideOf(c, i) === "home");
    const away = match.competitors.find((c, i) => sideOf(c, i) === "away");
    if (home?.winner) winnerSide = "home";
    else if (away?.winner) winnerSide = "away";
    else winnerSide = "draw"; // completed, nobody's `winner` is true — a genuine draw
  }

  return { externalId: match.id, status, winnerSide };
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
      for (const match of extractMatches(event, slug.matchStyle)) {
        const entry = mapMatchToScheduleEntry(match, params.sport, slug.allowsDraw);
        if (entry) entries.push(entry);
      }
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
        for (const match of extractMatches(event, slug.matchStyle)) {
          if (!externalIds.has(match.id)) continue;
          const result = mapMatchToResult(match);
          if (result) results.push(result);
        }
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
