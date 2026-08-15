import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { tournament, tournamentEntry } from "../db/schema.js";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { createGolfProvider, type CanonicalTournamentSnapshot, type GolfProvider } from "../lib/golf-provider.js";
import { gradeGolfPicks, voidTournamentPicks } from "../lib/golf-grading.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";
import { logger } from "../lib/logger.js";
import { toYyyyMmDd } from "../lib/sports-provider.js";

// Same rolling-window shape as schedule-ingest.ts, but golf doesn't
// need a separate postponement-recovery pass: a single scoreboard call
// per run already returns every currently-relevant PGA event (there's
// only ever 0-1 active/upcoming tournament in a given window, unlike
// the many-games-per-day team sports), so a postponed tournament's
// still-current date is trivially inside the same window on the next run.
const LOOKBACK_DAYS = 1;
const LOOKAHEAD_DAYS = 14;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Entry point for the scheduled golf-ingest job (Render Cron Job) —
 * see docs/sports-pipeline.md. Deliberately ONE combined job rather
 * than golf's own schedule-ingest/score-poll split: ESPN's golf
 * scoreboard endpoint always returns the tournament AND its current
 * leaderboard together in a single response (see golf-provider.ts), so
 * there's no separate "discover the schedule" call to make, and no
 * reason to run two jobs against the same one HTTP call.
 *
 * Tournament discovery, leaderboard polling, AND grading all happen
 * here every run. Grading is unconditional-overwrite (gradeGolfPicks),
 * not grade-once — this is the "live, updates during the tournament"
 * behavior confirmed by design: a member's pick can flip from losing
 * to winning (or back) as the leaderboard moves, all the way up to the
 * tournament's own final result. See lib/golf-grading.ts.
 */
export async function runGolfIngest(providerOverride?: GolfProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "golf-ingest" }, "golf-ingest started");

  try {
    const provider = providerOverride ?? createGolfProvider();

    const fromDate = toYyyyMmDd(addDays(startedAt, -LOOKBACK_DAYS));
    const toDate = toYyyyMmDd(addDays(startedAt, LOOKAHEAD_DAYS));
    const snapshots: CanonicalTournamentSnapshot[] = await provider.fetchTournaments({ fromDate, toDate });

    let itemCount = 0;
    for (const snapshot of snapshots) {
      itemCount += await ingestOneTournament(snapshot);
    }

    // Deliberately NOT alerted the way schedule-ingest alerts on zero
    // games: golf has frequent legitimate off-weeks (majors' off weeks,
    // the off-season) where zero tournaments in the window is entirely
    // expected, unlike the 11-sport near-year-round coverage that makes
    // an all-zero schedule-ingest run anomalous. See docs/sports-pipeline.md.

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "golf-ingest",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount,
      errorMessage: null,
    });

    logger.info(
      { job: "golf-ingest", itemCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "golf-ingest completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: "golf-ingest",
      startedAt,
      finishedAt: new Date(),
      succeeded: false,
      itemCount: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Upserts one tournament + its leaderboard entries, then grades/voids
 * picks against the freshly-written leaderboard. Returns 1 (itemCount
 * contribution) per tournament processed. */
async function ingestOneTournament(snapshot: CanonicalTournamentSnapshot): Promise<number> {
  const { tournament: t, leaderboard } = snapshot;

  const [upsertedRow] = await db
    .insert(tournament)
    .values({
      externalId: t.externalId,
      name: t.name,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      status: t.status,
    })
    .onConflictDoUpdate({
      target: tournament.externalId,
      set: {
        name: sql`excluded.name`,
        startsAt: sql`excluded.starts_at`,
        endsAt: sql`excluded.ends_at`,
        // Same single-writer-style protection schedule-ingest applies
        // to game.status, even though golf-ingest is this table's only
        // writer — a late/out-of-order response can never downgrade an
        // already-final tournament.
        status: sql`case when ${tournament.status} = 'final' then ${tournament.status} else excluded.status end`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: tournament.id, status: tournament.status });
  // A single values() insert always returns exactly one row —
  // .returning()'s type is just conservatively possibly-empty.
  const row = upsertedRow!;

  if (leaderboard.length > 0) {
    await db
      .insert(tournamentEntry)
      .values(
        leaderboard.map((entry) => ({
          tournamentId: row.id,
          externalId: entry.externalId,
          golferName: entry.golferName,
          flagUrl: entry.flagUrl,
          position: entry.position,
        })),
      )
      .onConflictDoUpdate({
        target: [tournamentEntry.tournamentId, tournamentEntry.externalId],
        set: {
          golferName: sql`excluded.golfer_name`,
          flagUrl: sql`excluded.flag_url`,
          position: sql`excluded.position`,
          updatedAt: sql`now()`,
        },
      });
  }

  if (row.status === "postponed" || row.status === "canceled") {
    await voidTournamentPicks(row.id, db);
  } else if (row.status === "in_progress" || row.status === "final") {
    // Not gated on `outcome is null` — this IS the live re-grade, and
    // eventually the permanent final grade once status stops changing.
    await gradeGolfPicks(row.id, db);
  }
  // status === "scheduled": entries are written (so the pick UI has a
  // field to choose from) but nothing to grade yet.

  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runGolfIngest()
    .then(() => pingHeartbeat(env.GOLF_INGEST_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "golf-ingest", err }, "golf-ingest failed");
      captureException(err);
      await pingHeartbeat(env.GOLF_INGEST_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
