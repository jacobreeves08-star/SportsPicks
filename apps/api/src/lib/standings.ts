import { DateTime } from "luxon";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { league, leagueMember, user } from "../db/schema.js";
import { dayBoundsUtc, weekBoundsUtc } from "./time.js";

/**
 * Standings (JAC-37-42) — see docs/scoring-and-standings.md for the full
 * design. Reads `pick.outcome` directly (written once at grade time by
 * lib/grading.ts) rather than recomputing win/loss from `result` on
 * every read, since standings are read constantly and graded once.
 *
 * Tiebreaker chain (confirmed with the user directly, not guessed):
 * win% -> head-to-head on commonly-picked games -> most recent correct
 * pick -> alphabetical by display name -> member id (a fallback that's
 * never actually reachable, but guarantees a strict order). Computed in
 * application code, not one monolithic query, because "head-to-head on
 * commonly-picked games" needs a dynamic set intersection across
 * however many members ended up tied — fragile to express as a single
 * SQL expression, and this needs to stay legible ("visible to members
 * rather than mysterious").
 */

export type Timeframe = "today" | "week" | "season";

export interface StandingsEntry {
  leagueMemberId: string;
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  gamesParticipated: number;
  winPct: number;
  rank: number;
}

interface ActiveMember {
  leagueMemberId: string;
  userId: string;
  displayName: string;
}

interface MemberRecord extends ActiveMember {
  wins: number;
  losses: number;
  gamesParticipated: number;
}

interface ClusterPick {
  leagueMemberId: string;
  gameId: string;
  outcome: "win" | "loss";
  gradedAt: Date;
}

/**
 * win% is computed as a single division of two small integers (wins /
 * gamesParticipated for a season's worth of picks). IEEE 754 division
 * is correctly rounded, so two mathematically equal fractions computed
 * this way (e.g. 2/3 and 4/6) always produce bit-identical doubles —
 * plain `===` is exact here, no epsilon comparison needed.
 */
function winPct(m: { wins: number; gamesParticipated: number }): number {
  return m.gamesParticipated === 0 ? 0 : m.wins / m.gamesParticipated;
}

function resolveTimeframeBounds(
  timeframe: Timeframe,
  referenceDate: string,
  ianaTimeZone: string,
  seasonStart: string,
): { start: Date; end: Date | null } {
  switch (timeframe) {
    case "today":
      return dayBoundsUtc(referenceDate, ianaTimeZone);
    case "week":
      return weekBoundsUtc(referenceDate, ianaTimeZone);
    case "season": {
      const start = DateTime.fromISO(seasonStart, { zone: ianaTimeZone }).startOf("day");
      if (!start.isValid) {
        throw new Error(
          `Invalid season start "${seasonStart}" or timezone "${ianaTimeZone}": ${start.invalidReason}`,
        );
      }
      // Unbounded on purpose: future/ungraded games are already excluded
      // by the `outcome is not null` filter below, so no upper bound is
      // needed to keep an in-progress season's standings correct.
      return { start: start.toUTC().toJSDate(), end: null };
    }
  }
}

async function fetchRecords(
  executor: typeof db,
  memberIds: string[],
  start: Date,
  end: Date | null,
): Promise<Map<string, { wins: number; losses: number; gamesParticipated: number }>> {
  const memberIdsSql = sql.join(
    memberIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await executor.execute<{
    league_member_id: string;
    wins: number;
    losses: number;
    games_participated: number;
  }>(sql`
    select
      p.league_member_id,
      count(*) filter (where p.outcome = 'win')::int as wins,
      count(*) filter (where p.outcome = 'loss')::int as losses,
      count(*) filter (where p.outcome != 'void')::int as games_participated
    from pick p
    join game g on g.id = p.game_id
    where p.league_member_id in (${memberIdsSql})
      and p.outcome is not null
      and g.starts_at >= ${start}
      and (${end}::timestamptz is null or g.starts_at < ${end})
    group by p.league_member_id
  `);
  return new Map(
    rows.rows.map((r) => [
      r.league_member_id,
      { wins: r.wins, losses: r.losses, gamesParticipated: r.games_participated },
    ]),
  );
}

async function fetchClusterPicks(
  executor: typeof db,
  memberIds: string[],
  start: Date,
  end: Date | null,
): Promise<ClusterPick[]> {
  const memberIdsSql = sql.join(
    memberIds.map((id) => sql`${id}`),
    sql`, `,
  );
  // NOTE: db.execute()'s raw path returns timestamptz columns as
  // Postgres's text representation, not a JS Date — unlike drizzle's
  // typed query builder (db.select()), which maps columns using schema
  // type info. Confirmed empirically (a `select now()` via db.execute
  // came back as a string, not a Date). graded_at is converted below.
  const rows = await executor.execute<{
    league_member_id: string;
    game_id: string;
    outcome: "win" | "loss";
    graded_at: string;
  }>(sql`
    select p.league_member_id, p.game_id, p.outcome, p.graded_at
    from pick p
    join game g on g.id = p.game_id
    where p.league_member_id in (${memberIdsSql})
      and p.outcome in ('win', 'loss')
      and g.starts_at >= ${start}
      and (${end}::timestamptz is null or g.starts_at < ${end})
  `);
  return rows.rows.map((r) => ({
    leagueMemberId: r.league_member_id,
    gameId: r.game_id,
    outcome: r.outcome,
    gradedAt: new Date(r.graded_at),
  }));
}

/**
 * Resolves one win%-tied cluster via the remaining tiebreaker chain.
 * Levels 3 (head-to-head) and 4 (recency) are expressed as a single
 * composite sort rather than literal sequential re-clustering — a
 * strict lexicographic sort on (head-to-head wins, most recent correct
 * pick, display name, member id) produces the identical final order to
 * clustering-then-resorting at each level, since each key only matters
 * when every key before it is exactly tied.
 */
function resolveCluster(cluster: MemberRecord[], clusterPicks: ClusterPick[]): MemberRecord[] {
  if (cluster.length === 1) return cluster;

  const clusterMemberIds = new Set(cluster.map((m) => m.leagueMemberId));
  const picksByMember = new Map<string, ClusterPick[]>();
  for (const p of clusterPicks) {
    if (!clusterMemberIds.has(p.leagueMemberId)) continue;
    const existing = picksByMember.get(p.leagueMemberId);
    if (existing) existing.push(p);
    else picksByMember.set(p.leagueMemberId, [p]);
  }

  // Commonly-picked games: every member of THIS cluster has a graded
  // pick for it (win or loss — void picks don't reflect a real call).
  const gamesByMember = cluster.map((m) => new Set((picksByMember.get(m.leagueMemberId) ?? []).map((p) => p.gameId)));
  const firstMemberGames = gamesByMember[0] ?? new Set<string>();
  const commonGameIds = new Set(
    [...firstMemberGames].filter((gameId) => gamesByMember.every((games) => games.has(gameId))),
  );

  const scored = cluster.map((record) => {
    const picks = picksByMember.get(record.leagueMemberId) ?? [];
    const headToHeadWins = picks.filter((p) => p.outcome === "win" && commonGameIds.has(p.gameId)).length;
    const mostRecentWinAt = picks
      .filter((p) => p.outcome === "win")
      .reduce((max, p) => Math.max(max, p.gradedAt.getTime()), -Infinity);
    return { record, headToHeadWins, mostRecentWinAt };
  });

  scored.sort((a, b) => {
    if (a.headToHeadWins !== b.headToHeadWins) return b.headToHeadWins - a.headToHeadWins;
    if (a.mostRecentWinAt !== b.mostRecentWinAt) return b.mostRecentWinAt - a.mostRecentWinAt;
    return (
      a.record.displayName.localeCompare(b.record.displayName) ||
      a.record.leagueMemberId.localeCompare(b.record.leagueMemberId)
    );
  });

  return scored.map((s) => s.record);
}

/**
 * Computes the ranked standings for one league/timeframe. `referenceDate`
 * (YYYY-MM-DD, interpreted in the league's timezone) is the day the
 * "today"/"week" windows are computed as of — the caller decides what
 * "now" means (e.g. the standings route defaults to today).
 */
export async function computeStandings(
  leagueId: string,
  timeframe: Timeframe,
  referenceDate: string,
): Promise<StandingsEntry[]> {
  const [leagueRow] = await db
    .select({ timezone: league.timezone, seasonStart: league.seasonStart })
    .from(league)
    .where(eq(league.id, leagueId));
  if (!leagueRow) throw new Error(`league not found: ${leagueId}`);

  const { start, end } = resolveTimeframeBounds(timeframe, referenceDate, leagueRow.timezone, leagueRow.seasonStart);

  const activeMembers: ActiveMember[] = await db
    .select({ leagueMemberId: leagueMember.id, userId: user.id, displayName: user.displayName })
    .from(leagueMember)
    .innerJoin(user, eq(user.id, leagueMember.userId))
    .where(and(eq(leagueMember.leagueId, leagueId), isNull(leagueMember.leftAt)));

  if (activeMembers.length === 0) return [];

  const memberIds = activeMembers.map((m) => m.leagueMemberId);

  // The base record query and the cluster head-to-head follow-up query
  // aren't naturally the same snapshot — a pick written or graded
  // concurrently between them could produce an inconsistent tiebreak.
  // REPEATABLE READ is a narrow, scoped exception to the app's default
  // READ COMMITTED (which lib/pick-write.ts relies on elsewhere for its
  // own reasons), used only for this pair of reads.
  const ranked = await db.transaction(
    async (tx) => {
      const executor = tx as unknown as typeof db;
      const recordsByMember = await fetchRecords(executor, memberIds, start, end);

      const records: MemberRecord[] = activeMembers.map((m) => {
        const r = recordsByMember.get(m.leagueMemberId);
        return {
          ...m,
          wins: r?.wins ?? 0,
          losses: r?.losses ?? 0,
          gamesParticipated: r?.gamesParticipated ?? 0,
        };
      });

      records.sort((a, b) => winPct(b) - winPct(a));

      const clusters: MemberRecord[][] = [];
      for (const record of records) {
        const last = clusters[clusters.length - 1];
        if (last && winPct(last[0]!) === winPct(record)) {
          last.push(record);
        } else {
          clusters.push([record]);
        }
      }

      const tiedMemberIds = clusters.filter((c) => c.length > 1).flatMap((c) => c.map((m) => m.leagueMemberId));
      const clusterPicks = tiedMemberIds.length > 0 ? await fetchClusterPicks(executor, tiedMemberIds, start, end) : [];

      return clusters.map((cluster) => resolveCluster(cluster, clusterPicks)).flat();
    },
    { isolationLevel: "repeatable read" },
  );

  return ranked.map((record, index) => ({
    leagueMemberId: record.leagueMemberId,
    userId: record.userId,
    displayName: record.displayName,
    wins: record.wins,
    losses: record.losses,
    gamesParticipated: record.gamesParticipated,
    winPct: winPct(record),
    rank: index + 1,
  }));
}
