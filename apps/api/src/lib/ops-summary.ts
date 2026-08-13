import { DateTime } from "luxon";
import { gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { league, pickAuditLog, resultCorrection, user } from "../db/schema.js";
import { computeSlateCompletionRate } from "./analytics.js";
import { findStaleGames } from "./game-staleness.js";
import { getJobRunStatus, type JobRunStatus } from "./job-run.js";

/**
 * Every job that /health/data-freshness and the operator digest
 * (JAC-48) track. Kept in one place so both consumers always agree.
 */
export const TRACKED_JOBS = [
  "schedule-ingest",
  "score-poll",
  "anonymize-accounts",
  "pick-reminder",
  "results-summary",
] as const;

export interface LeagueSlateCompletion {
  leagueId: string;
  leagueName: string;
  totalMembers: number;
  completedCount: number;
  rate: number | null;
}

export interface OpsSummary {
  jobs: JobRunStatus[];
  staleGameCount: number;
  correctionsLast24h: number;
  signupsLast24h: number;
  picksLast24h: number;
  slateCompletionRates: LeagueSlateCompletion[];
  generatedAt: Date;
}

/**
 * Closed-beta observability (JAC-48): the bar for public launch is
 * seven consecutive days where nobody had to ask what happened. This
 * is the one place that answers "what happened" — job health,
 * data-freshness, and yesterday-vs-today activity, all in one call.
 * Powers both /health/data-freshness (routes/health.routes.ts) and
 * the daily operator-digest.ts email.
 *
 * "Last 24h" windows and per-league "today" are both computed once,
 * at call time — this is a point-in-time snapshot, not itself cached,
 * matching this endpoint's existing no-auth/no-PII/always-fresh posture.
 */
export async function getOpsSummary(): Promise<OpsSummary> {
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

  const jobs = await Promise.all(TRACKED_JOBS.map((jobName) => getJobRunStatus(jobName)));
  const staleGames = await findStaleGames();

  const [correctionsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultCorrection)
    .where(gte(resultCorrection.createdAt, since));
  const [signupsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .where(gte(user.createdAt, since));
  // Ground truth for "picks in the last 24h", same reasoning as
  // computeSlateCompletionRate: pick_audit_log is append-only and
  // records every write (create or edit), unlike `pick`, which only
  // ever holds each member's current selection.
  const [picksRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pickAuditLog)
    .where(gte(pickAuditLog.createdAt, since));

  const leagues = await db.select({ id: league.id, name: league.name, timezone: league.timezone }).from(league);
  const slateCompletionRates: LeagueSlateCompletion[] = await Promise.all(
    leagues.map(async (l) => {
      const today = DateTime.now().setZone(l.timezone).toISODate()!;
      const result = await computeSlateCompletionRate(l.id, today);
      return { leagueId: l.id, leagueName: l.name, ...result };
    }),
  );

  return {
    jobs,
    staleGameCount: staleGames.length,
    correctionsLast24h: correctionsRow!.count,
    signupsLast24h: signupsRow!.count,
    picksLast24h: picksRow!.count,
    slateCompletionRates,
    generatedAt,
  };
}
