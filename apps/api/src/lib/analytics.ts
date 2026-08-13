import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsEvent, league, leagueMember } from "../db/schema.js";
import { captureException } from "./error-tracking.js";
import { logger } from "./logger.js";
import { dayBoundsUtc } from "./time.js";

/**
 * Self-built analytics (JAC-44) — confirmed with the user as a plain
 * Postgres table, not a third-party platform, since every event this
 * epic asked for is already server-observable. See docs/analytics.md.
 */
export interface LogEventParams {
  userId?: string;
  leagueId?: string;
  leagueMemberId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort, fire-and-forget: analytics must never break a real user
 * action. Any failure (a bad connection, a constraint violation) is
 * caught, reported to error tracking, and swallowed — never rethrown.
 */
export async function logEvent(eventType: string, params: LogEventParams = {}): Promise<void> {
  try {
    await db.insert(analyticsEvent).values({
      eventType,
      userId: params.userId ?? null,
      leagueId: params.leagueId ?? null,
      leagueMemberId: params.leagueMemberId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    captureException(err);
    logger.warn({ err, eventType }, "analytics: logEvent failed, dropping event");
  }
}

export interface SlateCompletionRate {
  totalMembers: number;
  completedCount: number;
  /** null when there's nothing to measure (no games or no active members that day). */
  rate: number | null;
}

/**
 * The metric that matters (JAC-44): what fraction of a league's active
 * members had EVERY game in a day's slate picked before that day's
 * first lock. Computed from ground truth (`pick_audit_log`), never
 * from the `analytics_event` log — the event log can miss events
 * (best-effort, see above) and was never meant to be authoritative.
 *
 * The finalization signal for each (member, game) pair is
 * `pick_audit_log`'s MAX(created_at), not `pick.created_at`.
 * `pick.created_at` is set once on insert and never touched by
 * `writePick`'s `ON CONFLICT DO UPDATE` — reading it directly would
 * understate lateness for a pick made early, then edited after the
 * first lock: the member's SETTLED answer only became final at the
 * edit, so it should count as late. Same class of finding as
 * `result.created_at` vs `game.updated_at` in docs/scoring-and-standings.md.
 */
export async function computeSlateCompletionRate(leagueId: string, date: string): Promise<SlateCompletionRate> {
  const [leagueRow] = await db
    .select({ sports: league.sports, timezone: league.timezone })
    .from(league)
    .where(eq(league.id, leagueId));
  if (!leagueRow) throw new Error(`league not found: ${leagueId}`);

  const { start, end } = dayBoundsUtc(date, leagueRow.timezone);
  const sportsSql = sql.join(
    leagueRow.sports.map((s) => sql`${s}`),
    sql`, `,
  );

  const gamesResult = await db.execute<{ id: string; starts_at: string }>(sql`
    select id, starts_at from game g
    where g.sport in (${sportsSql})
      and g.starts_at >= ${start} and g.starts_at < ${end}
      and g.status not in ('postponed', 'canceled')
    order by g.starts_at
  `);
  const games = gamesResult.rows;
  if (games.length === 0) return { totalMembers: 0, completedCount: 0, rate: null };

  const firstLockAt = new Date(games[0]!.starts_at);
  const gameIds = games.map((g) => g.id);

  const activeMembers = await db
    .select({ id: leagueMember.id })
    .from(leagueMember)
    .where(and(eq(leagueMember.leagueId, leagueId), isNull(leagueMember.leftAt)));
  if (activeMembers.length === 0) return { totalMembers: 0, completedCount: 0, rate: null };

  const memberIdsSql = sql.join(
    activeMembers.map((m) => sql`${m.id}`),
    sql`, `,
  );
  const gameIdsSql = sql.join(
    gameIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const latestActionsResult = await db.execute<{ league_member_id: string; game_id: string; latest_at: string }>(sql`
    select league_member_id, game_id, max(created_at) as latest_at
    from pick_audit_log
    where league_member_id in (${memberIdsSql}) and game_id in (${gameIdsSql})
    group by league_member_id, game_id
  `);

  const latestByMemberGame = new Map<string, Date>();
  for (const row of latestActionsResult.rows) {
    latestByMemberGame.set(`${row.league_member_id}:${row.game_id}`, new Date(row.latest_at));
  }

  let completedCount = 0;
  for (const member of activeMembers) {
    const completed = gameIds.every((gameId) => {
      const latest = latestByMemberGame.get(`${member.id}:${gameId}`);
      return latest !== undefined && latest <= firstLockAt;
    });
    if (completed) completedCount += 1;
  }

  return { totalMembers: activeMembers.length, completedCount, rate: completedCount / activeMembers.length };
}
