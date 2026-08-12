import { pathToFileURL } from "node:url";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { session, user, verificationToken } from "../db/schema.js";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { generateOpaqueToken } from "../lib/tokens.js";
import { nowUtc } from "../lib/time.js";

/**
 * Entry point for the scheduled account-anonymization job (Render Cron
 * Job) — see docs/account-anonymization.md for the exact, authoritative
 * spec this implements. Structurally mirrors score-poll.ts (same
 * entrypoint guard, error tracking, dedicated heartbeat, exit-code
 * handling — see the comments there for why each piece is built the
 * way it is).
 *
 * Finds every user past their deletion grace period and not yet
 * anonymized, and for each: scrubs personal fields (email, password,
 * display name, avatar, any pending email change) to a permanent
 * tombstone, and deletes their sessions/verification tokens. The user
 * row itself, and their league_member/pick rows, are never touched —
 * anonymization is the whole point, not deletion — so historical
 * standings and picks still reconcile for everyone else in their leagues.
 */
export async function runAnonymizeAccounts(): Promise<void> {
  const startedAt = Date.now();
  logger.info({ job: "anonymize-accounts" }, "anonymize-accounts started");

  const now = nowUtc().toJSDate();
  const due = await db
    .select({ id: user.id })
    .from(user)
    .where(and(lte(user.scheduledDeletionAt, now), isNull(user.anonymizedAt)));

  let anonymizedCount = 0;

  for (const { id: userId } of due) {
    // One transaction per user, same resilience posture as migrate.ts —
    // one bad row shouldn't block the rest of the batch.
    await db.transaction(async (tx) => {
      const unusablePasswordHash = await hashPassword(generateOpaqueToken());

      await tx
        .update(user)
        .set({
          email: `deleted-${userId}@tombstone.invalid`,
          passwordHash: unusablePasswordHash,
          displayName: "Deleted User",
          avatarUrl: null,
          pendingEmail: null,
          anonymizedAt: nowUtc().toJSDate(),
        })
        .where(eq(user.id, userId));

      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(verificationToken).where(eq(verificationToken.userId, userId));
    });

    anonymizedCount += 1;
  }

  logger.info(
    { job: "anonymize-accounts", anonymizedCount, durationMs: Date.now() - startedAt },
    "anonymize-accounts completed",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runAnonymizeAccounts()
    .then(() => pingHeartbeat(env.ANONYMIZATION_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "anonymize-accounts", err }, "anonymize-accounts failed");
      captureException(err);
      await pingHeartbeat(env.ANONYMIZATION_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
