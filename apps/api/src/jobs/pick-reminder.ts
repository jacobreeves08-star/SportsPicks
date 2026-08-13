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
import { dayBoundsUtc } from "../lib/time.js";

/**
 * Entry point for the scheduled pick-reminder job (Render Cron Job,
 * every 10 minutes) — see docs/notifications.md for the full design.
 * Structurally mirrors score-poll.ts/anonymize-accounts.ts (same
 * entrypoint guard, error tracking, dedicated heartbeat).
 *
 * For each league, finds today's first lock (in the LEAGUE's timezone —
 * the existing, established convention for what "today" means
 * everywhere else in this app, e.g. the slate endpoint — never the
 * member's). If that first lock falls within REMINDER_LEAD_TIME_MINUTES
 * from now, every active member with notifications enabled (global AND
 * per-league) and at least one unpicked, non-postponed/cancelled game
 * today gets exactly one reminder, reserved via notification_log's
 * unique index so a second run inside the same window (or a retry)
 * can't double-send. "In the member's own timezone" is about how the
 * email's CONTENT is formatted (lock times shown via user.timezone),
 * not about redefining which calendar day a league's slate belongs to
 * per member — the send trigger is anchored to the absolute lock
 * instant, timezone-independent by construction.
 *
 * Scoped literally to "the first lock of the day" as specified — a
 * league with an early game and a separate later slate the same day
 * sends exactly one reminder, anchored to the early lock; a member who
 * misses that window gets no further nudge before the later lock even
 * though picking is still open for it. Flagged in docs/notifications.md
 * as a possible product gap, not fixed here.
 */
export async function runPickReminder(emailProviderOverride?: EmailProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "pick-reminder" }, "pick-reminder started");

  try {
    const leagues = await db
      .select({ id: league.id, name: league.name, sports: league.sports, timezone: league.timezone })
      .from(league);

    const emailProvider = emailProviderOverride ?? createEmailProvider();
    const windowEnd = new Date(startedAt.getTime() + env.REMINDER_LEAD_TIME_MINUTES * 60_000);
    let sentCount = 0;

    for (const leagueRow of leagues) {
      const today = DateTime.now().setZone(leagueRow.timezone).toISODate();
      if (!today) {
        // Should be unreachable — timezone is validated at league
        // creation — but never let one bad row crash the whole run.
        logger.warn({ job: "pick-reminder", leagueId: leagueRow.id }, "could not resolve today's date, skipping");
        continue;
      }
      const { start, end } = dayBoundsUtc(today, leagueRow.timezone);

      const sportsSql = sql.join(
        leagueRow.sports.map((s) => sql`${s}`),
        sql`, `,
      );

      // First lock among today's non-postponed/cancelled games —
      // postponed/canceled games are excluded here (their starts_at
      // isn't reliable, and there's nothing actionable about them
      // anyway) and from the "unpicked" set below (writePick already
      // rejects picks against both, so counting them would nag about a
      // game nobody can act on).
      const firstLockResult = await db.execute<{ first_lock_at: string | null }>(sql`
        select min(g.starts_at) as first_lock_at
        from game g
        where g.sport in (${sportsSql})
          and g.starts_at >= ${start} and g.starts_at < ${end}
          and g.status not in ('postponed', 'canceled')
      `);
      const firstLockAtRaw = firstLockResult.rows[0]?.first_lock_at;
      if (!firstLockAtRaw) continue; // no games today for this league

      const firstLockAt = new Date(firstLockAtRaw);
      if (!(firstLockAt > startedAt && firstLockAt <= windowEnd)) continue;

      const recipientsResult = await db.execute<{
        league_member_id: string;
        email: string;
        display_name: string;
        timezone: string;
      }>(sql`
        select lm.id as league_member_id, u.email, u.display_name, u.timezone
        from league_member lm
        join "user" u on u.id = lm.user_id
        where lm.league_id = ${leagueRow.id} and lm.left_at is null
          and u.notifications_enabled and lm.notifications_enabled
          and exists (
            select 1 from game g
            where g.sport in (${sportsSql})
              and g.starts_at >= ${start} and g.starts_at < ${end}
              and g.status not in ('postponed', 'canceled')
              and not exists (select 1 from pick p where p.game_id = g.id and p.league_member_id = lm.id)
          )
      `);

      for (const recipient of recipientsResult.rows) {
        // Reserve-then-send: only send if the insert actually returned
        // a row. Same idiom score-poll.ts uses for exactly-once
        // finalization, applied here via ON CONFLICT DO NOTHING against
        // notification_log's (type, member, date) unique index.
        const reserved = await db.execute<{ id: string }>(sql`
          insert into notification_log (notification_type, league_id, league_member_id, notification_date)
          values ('pick_reminder', ${leagueRow.id}, ${recipient.league_member_id}, ${today})
          on conflict do nothing
          returning id
        `);
        if (reserved.rows.length === 0) continue; // already sent today

        const unpickedGamesResult = await db.execute<{ home_team: string; away_team: string; starts_at: string }>(sql`
          select g.home_team, g.away_team, g.starts_at
          from game g
          where g.sport in (${sportsSql})
            and g.starts_at >= ${start} and g.starts_at < ${end}
            and g.status not in ('postponed', 'canceled')
            and not exists (
              select 1 from pick p where p.game_id = g.id and p.league_member_id = ${recipient.league_member_id}
            )
          order by g.starts_at
        `);

        await emailProvider.sendPickReminderEmail(recipient.email, {
          leagueName: leagueRow.name,
          unpickedGames: unpickedGamesResult.rows.map((g) => ({
            homeTeam: g.home_team,
            awayTeam: g.away_team,
            startsAt: new Date(g.starts_at),
          })),
          firstLockAt,
          timezone: recipient.timezone,
        });
        sentCount += 1;
      }
    }

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "pick-reminder",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount: sentCount,
      errorMessage: null,
    });
    logger.info(
      { job: "pick-reminder", sentCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "pick-reminder completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: "pick-reminder",
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
  runPickReminder()
    .then(() => pingHeartbeat(env.PICK_REMINDER_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "pick-reminder", err }, "pick-reminder failed");
      captureException(err);
      await pingHeartbeat(env.PICK_REMINDER_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
