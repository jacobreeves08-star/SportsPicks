import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { nflAthlete } from "../db/schema.js";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { createNflAthleteProvider, type NflAthleteProvider } from "../lib/nfl-athlete-provider.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";

/**
 * Refreshes the NFL player pool the daily college quiz draws its
 * questions from (docs/college-trivia.md).
 *
 * Runs weekly, not every few minutes like schedule-ingest/score-poll,
 * because the thing it tracks barely moves: a player's COLLEGE never
 * changes at all, and the only volatility is roster churn (who's
 * active vs. practice squad, and which rookies exist), which resolves
 * on a weekly cadence at best. The quiz is fully playable from a pool
 * that is a week stale, so there is nothing to gain from polling
 * harder against a free, undocumented, unthrottled-by-courtesy API.
 *
 * Purely additive — an upsert per athlete, never a delete. A player who
 * retires simply stops being returned by ESPN, and their row stays
 * behind: dropping them would break `trivia_question.athlete_id` for
 * every past puzzle they appeared in, rewriting history for anyone who
 * shared a result. They fall out of new puzzles naturally, since their
 * roster_status stops being refreshed to 'active'.
 */
export async function runNflAthleteIngest(providerOverride?: NflAthleteProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "nfl-athlete-ingest" }, "nfl-athlete-ingest started");

  try {
    const provider = providerOverride ?? createNflAthleteProvider();
    const athletes = await provider.fetchAthletes();

    let itemCount = 0;
    for (const athlete of athletes) {
      await db
        .insert(nflAthlete)
        .values({
          externalId: athlete.externalId,
          displayName: athlete.displayName,
          positionAbbreviation: athlete.positionAbbreviation,
          jersey: athlete.jersey,
          headshotUrl: athlete.headshotUrl,
          teamExternalId: athlete.teamExternalId,
          teamDisplayName: athlete.teamDisplayName,
          collegeName: athlete.collegeName,
          collegeExternalId: athlete.collegeExternalId,
          collegeLogoUrl: athlete.collegeLogoUrl,
          rosterStatus: athlete.rosterStatus,
          experienceYears: athlete.experienceYears,
        })
        .onConflictDoUpdate({
          target: nflAthlete.externalId,
          set: {
            displayName: sql`excluded.display_name`,
            positionAbbreviation: sql`excluded.position_abbreviation`,
            jersey: sql`excluded.jersey`,
            headshotUrl: sql`excluded.headshot_url`,
            teamExternalId: sql`excluded.team_external_id`,
            teamDisplayName: sql`excluded.team_display_name`,
            collegeName: sql`excluded.college_name`,
            collegeExternalId: sql`excluded.college_external_id`,
            collegeLogoUrl: sql`excluded.college_logo_url`,
            rosterStatus: sql`excluded.roster_status`,
            experienceYears: sql`excluded.experience_years`,
            updatedAt: new Date(),
          },
        });
      itemCount++;
    }

    // Zero athletes IS anomalous here, unlike golf-ingest's legitimate
    // off-weeks: the 32 NFL rosters are populated year-round, so an
    // empty run means ESPN changed shape or is down, not that there's
    // nothing to fetch. Logged at error level so the job-failure alert
    // (docs/observability.md) has something to catch — but the run is
    // still recorded as succeeded, because nothing actually threw and
    // the existing pool is untouched and still perfectly playable.
    if (itemCount === 0) {
      logger.error({ job: "nfl-athlete-ingest" }, "nfl-athlete-ingest found zero athletes — check the provider");
    }

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "nfl-athlete-ingest",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount,
      errorMessage: null,
    });

    logger.info({ job: "nfl-athlete-ingest", itemCount }, "nfl-athlete-ingest finished");
  } catch (err) {
    captureException(err);
    await recordJobRun({
      jobName: "nfl-athlete-ingest",
      startedAt,
      finishedAt: new Date(),
      succeeded: false,
      itemCount: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    logger.error({ job: "nfl-athlete-ingest", err }, "nfl-athlete-ingest failed");
    throw err;
  }
}

// Same entry-point guard every other job in this directory uses — the
// module is importable by tests without executing the job.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runNflAthleteIngest()
    .then(() => pingHeartbeat(env.NFL_ATHLETE_INGEST_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "nfl-athlete-ingest", err }, "nfl-athlete-ingest failed");
      captureException(err);
      await pingHeartbeat(env.NFL_ATHLETE_INGEST_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
