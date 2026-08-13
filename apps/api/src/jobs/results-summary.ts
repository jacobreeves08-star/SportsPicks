import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { league } from "../db/schema.js";
import { createEmailProvider, type EmailProvider } from "../lib/email-provider.js";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";
import { logger } from "../lib/logger.js";
import { computeStandings } from "../lib/standings.js";
import { dayBoundsUtc } from "../lib/time.js";

/**
 * Entry point for the scheduled results-summary job (Render Cron Job,
 * every 10 minutes) — see docs/notifications.md. Kept separate from
 * pick-reminder.ts and score-poll.ts rather than bolted onto either:
 * this job's correctness depends on grading having already happened
 * and on the standings engine, not on the sports provider, matching
 * the "one job, one concern, one heartbeat" convention already
 * applied to every other job pair on a different schedule.
 *
 * A league's day is "settled" once it has at least one game today (in
 * the league's timezone — the established convention) and none of
 * today's games remain 'scheduled'/'in_progress' (postponed/cancelled
 * count as settled — there's nothing left to wait for). For each
 * settled league, computeStandings('today') is reused directly from
 * Epic 6, plus the same prior-day rank-diff standings.routes.ts
 * already computes for `rankChange`.
 *
 * Reserved and sent PER MEMBER, not per league, deliberately — this
 * makes the job resumable after a partial failure. If it crashes
 * after emailing 3 of 8 members, the next run's "settled" check still
 * matches (settled is a fact about the games, not about whether this
 * job already ran), and the per-member notification_log guard means
 * only the remaining 5 get sent, not a re-send to all 8 or a
 * permanent skip of all 8.
 *
 * Flagged, not fixed: score-poll's automatic revision detection
 * re-checks final games for up to REVISION_CHECK_WINDOW_HOURS after
 * result.created_at. If a provider revision lands after today's
 * digest already sent, the per-member-per-day notification_log guard
 * means no second digest goes out — a member's emailed standings can
 * go stale relative to a correction they were never told about.
 */
export async function runResultsSummary(emailProviderOverride?: EmailProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "results-summary" }, "results-summary started");

  try {
    const leagues = await db
      .select({ id: league.id, name: league.name, sports: league.sports, timezone: league.timezone })
      .from(league);

    const emailProvider = emailProviderOverride ?? createEmailProvider();
    let sentCount = 0;

    for (const leagueRow of leagues) {
      const today = DateTime.now().setZone(leagueRow.timezone).toISODate();
      if (!today) {
        logger.warn({ job: "results-summary", leagueId: leagueRow.id }, "could not resolve today's date, skipping");
        continue;
      }
      const { start, end } = dayBoundsUtc(today, leagueRow.timezone);

      const sportsSql = sql.join(
        leagueRow.sports.map((s) => sql`${s}`),
        sql`, `,
      );

      const settledResult = await db.execute<{ total: string; unsettled: string }>(sql`
        select
          count(*) as total,
          count(*) filter (where g.status in ('scheduled', 'in_progress')) as unsettled
        from game g
        where g.sport in (${sportsSql})
          and g.starts_at >= ${start} and g.starts_at < ${end}
      `);
      const settledRow = settledResult.rows[0];
      const total = settledRow ? Number(settledRow.total) : 0;
      const unsettled = settledRow ? Number(settledRow.unsettled) : 0;
      if (total === 0 || unsettled > 0) continue; // no games today, or still in progress

      const recipientsResult = await db.execute<{ league_member_id: string; email: string }>(sql`
        select lm.id as league_member_id, u.email
        from league_member lm
        join "user" u on u.id = lm.user_id
        where lm.league_id = ${leagueRow.id} and lm.left_at is null
          and u.notifications_enabled and lm.notifications_enabled
      `);
      if (recipientsResult.rows.length === 0) continue;

      const current = await computeStandings(leagueRow.id, "today", today);
      const currentByMember = new Map(current.map((c) => [c.leagueMemberId, c]));

      const yesterday = DateTime.fromISO(today, { zone: leagueRow.timezone }).minus({ days: 1 }).toISODate();
      const prior = yesterday ? await computeStandings(leagueRow.id, "today", yesterday) : [];
      const priorRankByMember = new Map(prior.map((p) => [p.leagueMemberId, p.rank]));

      for (const recipient of recipientsResult.rows) {
        const entry = currentByMember.get(recipient.league_member_id);
        if (!entry) continue; // not an active member as of today's standings snapshot

        // Reserve-then-send, same idiom as pick-reminder.ts, applied
        // per member so a partial failure is resumable — see doc
        // comment above.
        const reserved = await db.execute<{ id: string }>(sql`
          insert into notification_log (notification_type, league_id, league_member_id, notification_date)
          values ('results_summary', ${leagueRow.id}, ${recipient.league_member_id}, ${today})
          on conflict do nothing
          returning id
        `);
        if (reserved.rows.length === 0) continue; // already sent today

        const priorRank = priorRankByMember.get(recipient.league_member_id);
        const rankChange = priorRank === undefined ? null : priorRank - entry.rank;

        await emailProvider.sendResultsSummaryEmail(recipient.email, {
          leagueName: leagueRow.name,
          wins: entry.wins,
          losses: entry.losses,
          rank: entry.rank,
          rankChange,
        });
        sentCount += 1;
      }
    }

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "results-summary",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount: sentCount,
      errorMessage: null,
    });
    logger.info(
      { job: "results-summary", sentCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "results-summary completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: "results-summary",
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
  runResultsSummary()
    .then(() => pingHeartbeat(env.RESULTS_SUMMARY_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "results-summary", err }, "results-summary failed");
      captureException(err);
      await pingHeartbeat(env.RESULTS_SUMMARY_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
