import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game } from "../db/schema.js";
import { captureException, captureMessage, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { voidGamePicksForGames } from "../lib/grading.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";
import { logger } from "../lib/logger.js";
import {
  createSportsProvider,
  ESPN_SPORT_SLUGS,
  toYyyyMmDd,
  type CanonicalScheduleEntry,
  type SportsProvider,
} from "../lib/sports-provider.js";

// Small safety margin for ESPN's date-bucketing quirk (see
// sports-provider.ts's fetchResults comment), NOT a blanket re-scan
// window — the "never downgrade final" protection below is what makes
// re-scanning recently-finished games safe regardless of window size.
const LOOKBACK_DAYS = 1;
// NFL flex scheduling can change as late as 6 days out; 14 days gives
// comfortable margin without being wasteful.
const LOOKAHEAD_DAYS = 14;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Entry point for the scheduled schedule-ingest job (Render Cron Job) —
 * see docs/sports-pipeline.md for the full edge-case behavior this
 * implements. Pulls a rolling forward window per sport, idempotently
 * upserts by external_id, and separately re-checks every currently-
 * postponed game's own date (unbounded by the rolling window) so a
 * postponement resolved weeks later is still caught.
 *
 * schedule-ingest never finalizes a game or writes a result row — only
 * score-poll does that. This is enforced at the database write, not
 * just by convention: an existing row's status can never be downgraded
 * FROM 'final' by this job's upsert, no matter what it computes, so
 * re-scanning a recently-finished game within the lookback window can
 * never silently revert it.
 */
export async function runScheduleIngest(providerOverride?: SportsProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "schedule-ingest" }, "schedule-ingest started");

  try {
    const provider = providerOverride ?? createSportsProvider();
    // Dedupe by externalId across the postponement-recovery pass and
    // the regular window pass — last write wins on any overlap.
    const entries = new Map<string, CanonicalScheduleEntry>();

    const postponedGames = await db
      .select({ sport: game.sport, startsAt: game.startsAt })
      .from(game)
      .where(eq(game.status, "postponed"));

    const postponedGroups = new Map<string, { sport: string; date: string }>();
    for (const g of postponedGames) {
      const date = toYyyyMmDd(g.startsAt);
      postponedGroups.set(`${g.sport}|${date}`, { sport: g.sport, date });
    }
    for (const { sport, date } of postponedGroups.values()) {
      try {
        const recovered = await provider.fetchSchedule({ sport, fromDate: date, toDate: date });
        for (const entry of recovered) entries.set(entry.externalId, entry);
      } catch (err) {
        // One postponed game's re-fetch failing (e.g. a sport with no
        // scoreboard for that date range at all) must not block recovery
        // for every OTHER postponed game — see the per-sport loop below
        // for the same reasoning, discovered live against real ESPN.
        logger.warn({ job: "schedule-ingest", sport, date, err }, "postponement re-fetch failed for one sport/date, continuing");
      }
    }

    const fromDate = toYyyyMmDd(addDays(startedAt, -LOOKBACK_DAYS));
    const toDate = toYyyyMmDd(addDays(startedAt, LOOKAHEAD_DAYS));
    const sports = Object.keys(ESPN_SPORT_SLUGS);
    let erroredSports = 0;
    // Sequential, not parallel — keeps the adapter's in-run circuit
    // breaker's consecutive-failure count meaningful across the whole run.
    for (const sport of sports) {
      try {
        const schedule = await provider.fetchSchedule({ sport, fromDate, toDate });
        for (const entry of schedule) entries.set(entry.externalId, entry);
      } catch (err) {
        // Discovered live: ESPN 404s an out-of-season sport's scoreboard
        // (confirmed for NCAA men's basketball in August) rather than
        // returning an empty array. One sport failing — off-season 404,
        // transient outage, whatever — must not fail every OTHER sport's
        // ingest for this run.
        erroredSports += 1;
        logger.warn({ job: "schedule-ingest", sport, err }, "schedule fetch failed for one sport, continuing");
      }
    }

    // Distinct from "every sport legitimately returned zero games" (which
    // the captureMessage alert below covers): if every single fetch
    // actually THREW, that's a total outage, not a quiet slate, and the
    // run should be recorded as a genuine failure — matching what a plain
    // unguarded provider error would have done before per-sport catches.
    if (erroredSports === sports.length) {
      throw new Error(`schedule-ingest: all ${sports.length} sports failed to fetch`);
    }

    const bySport = new Map<string, CanonicalScheduleEntry[]>();
    for (const entry of entries.values()) {
      const list = bySport.get(entry.sport);
      if (list) list.push(entry);
      else bySport.set(entry.sport, [entry]);
    }

    let itemCount = 0;
    for (const sportEntries of bySport.values()) {
      if (sportEntries.length === 0) continue;

      const rows = await db
        .insert(game)
        .values(
          sportEntries.map((e) => ({
            externalId: e.externalId,
            sport: e.sport,
            homeTeam: e.homeTeam.displayName,
            awayTeam: e.awayTeam.displayName,
            homeTeamExternalId: e.homeTeam.externalId,
            awayTeamExternalId: e.awayTeam.externalId,
            startsAt: e.startsAt,
            // schedule-ingest never inserts a brand-new row as 'final'
            // — only score-poll writes that transition (+ the result
            // row that must accompany it). The rare case of a genuinely
            // new-to-us game that's already final self-corrects within
            // score-poll's own next 5-minute cycle.
            status: e.status === "final" ? "in_progress" : e.status,
            allowsDraw: e.allowsDraw,
          })),
        )
        .onConflictDoUpdate({
          target: game.externalId,
          set: {
            sport: sql`excluded.sport`,
            homeTeam: sql`excluded.home_team`,
            awayTeam: sql`excluded.away_team`,
            homeTeamExternalId: sql`excluded.home_team_external_id`,
            awayTeamExternalId: sql`excluded.away_team_external_id`,
            startsAt: sql`excluded.starts_at`,
            // The actual single-writer boundary, enforced at the row
            // level: once a game's status is 'final', this job can
            // never overwrite it, no matter what it computes — only
            // score-poll can set (or, in principle, unset) 'final'.
            status: sql`case when ${game.status} = 'final' then ${game.status} else excluded.status end`,
            allowsDraw: sql`excluded.allows_draw`,
          },
        })
        .returning({ id: game.id });

      itemCount += rows.length;

      // One statement per sport, not per row (JAC-37-42) — matching the
      // upsert above's own batching. Voids ungraded picks for any of
      // the JUST-touched games that are now postponed/cancelled;
      // no-op for the rest (the WHERE inside checks CURRENT status, not
      // whether this write's `status` value happened to be one of
      // those). Postponed games also self-heal via the unbounded
      // postponed-recovery pass above, keeping them in `rows` on every
      // future run for as long as they stay postponed; the score-poll
      // reconciliation sweep covers cancelled games once their date
      // ages out of this job's lookback window. See
      // docs/scoring-and-standings.md.
      await voidGamePicksForGames(
        rows.map((r) => r.id),
        db,
      );
    }

    if (itemCount === 0) {
      captureMessage("schedule-ingest: zero games found across all 8 tracked sports in one run", {
        fromDate,
        toDate,
      });
      logger.warn({ job: "schedule-ingest" }, "zero games found across all tracked sports");
    }

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "schedule-ingest",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount,
      errorMessage: null,
    });

    logger.info(
      { job: "schedule-ingest", itemCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "schedule-ingest completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: "schedule-ingest",
      startedAt,
      finishedAt: new Date(),
      succeeded: false,
      itemCount: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runScheduleIngest()
    .then(() => pingHeartbeat(env.SCHEDULE_INGEST_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "schedule-ingest", err }, "schedule-ingest failed");
      captureException(err);
      await pingHeartbeat(env.SCHEDULE_INGEST_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
