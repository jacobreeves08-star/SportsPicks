import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { jobRun, leagueMember, pushToken, session, user, verificationToken } from "../db/schema.js";
import {
  createTestLeague,
  createTestLeagueMember,
  createTestPushToken,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { getJobRunStatus } from "../lib/job-run.js";
import { createSession } from "../lib/session.js";
import { nowUtc } from "../lib/time.js";
import { issueVerificationToken } from "../lib/verification-tokens.js";
import { runAnonymizeAccounts } from "./anonymize-accounts.js";

beforeEach(async () => {
  await truncateAllTables();
});

async function markDue(userId: string) {
  await db
    .update(user)
    .set({ scheduledDeletionAt: nowUtc().minus({ days: 1 }).toJSDate() })
    .where(eq(user.id, userId));
}

describe("runAnonymizeAccounts", () => {
  it("scrubs personal fields and deletes sessions/tokens for a due account", async () => {
    const testUser = await createTestUser({ email: "todelete@example.com", displayName: "Real Name" });
    await markDue(testUser.id);
    await createSession(testUser.id);
    await issueVerificationToken(testUser.id, "email_verify");

    await runAnonymizeAccounts();

    const [after] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);
    expect(after!.email).toBe(`deleted-${testUser.id}@tombstone.invalid`);
    expect(after!.displayName).toBe("Deleted User");
    expect(after!.avatarUrl).toBeNull();
    expect(after!.pendingEmail).toBeNull();
    expect(after!.anonymizedAt).not.toBeNull();
    // password_hash is replaced, not cleared — well-formed but unusable.
    expect(after!.passwordHash).not.toBe("unused-in-fixtures");
    expect(after!.passwordHash.startsWith("$argon2id$")).toBe(true);

    const sessions = await db.select().from(session).where(eq(session.userId, testUser.id));
    const tokens = await db.select().from(verificationToken).where(eq(verificationToken.userId, testUser.id));
    expect(sessions).toHaveLength(0);
    expect(tokens).toHaveLength(0);
  });

  it("preserves the user row and their league_member row", async () => {
    const testUser = await createTestUser();
    const testLeague = await createTestLeague(testUser.id);
    const member = await createTestLeagueMember(testUser.id, testLeague.id);
    await markDue(testUser.id);

    await runAnonymizeAccounts();

    const [userRow] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);
    expect(userRow).toBeDefined();

    const [memberRow] = await db.select().from(leagueMember).where(eq(leagueMember.id, member.id)).limit(1);
    expect(memberRow).toBeDefined();
  });

  it("does not touch an account whose grace period hasn't elapsed yet", async () => {
    const testUser = await createTestUser({ email: "notyet@example.com" });
    await db
      .update(user)
      .set({ scheduledDeletionAt: nowUtc().plus({ days: 10 }).toJSDate() })
      .where(eq(user.id, testUser.id));

    await runAnonymizeAccounts();

    const [after] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);
    expect(after!.email).toBe("notyet@example.com");
    expect(after!.anonymizedAt).toBeNull();
  });

  it("does not touch an account with no deletion scheduled at all", async () => {
    const testUser = await createTestUser({ email: "safe@example.com" });

    await runAnonymizeAccounts();

    const [after] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);
    expect(after!.email).toBe("safe@example.com");
  });

  it("is idempotent — running twice doesn't re-process an already-anonymized account", async () => {
    const testUser = await createTestUser();
    await markDue(testUser.id);

    await runAnonymizeAccounts();
    const [firstPass] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);

    await runAnonymizeAccounts();
    const [secondPass] = await db.select().from(user).where(eq(user.id, testUser.id)).limit(1);

    expect(secondPass!.anonymizedAt).toEqual(firstPass!.anonymizedAt);
  });

  it("hard-deletes push tokens for an anonymized account (JAC-43-48)", async () => {
    const testUser = await createTestUser();
    await createTestPushToken(testUser.id);
    await markDue(testUser.id);

    await runAnonymizeAccounts();

    const tokens = await db.select().from(pushToken).where(eq(pushToken.userId, testUser.id));
    expect(tokens).toHaveLength(0);
  });

  it("records a job_run so it's visible to /health/data-freshness (JAC-43-48 gap fix)", async () => {
    const testUser = await createTestUser();
    await markDue(testUser.id);

    await runAnonymizeAccounts();

    const status = await getJobRunStatus("anonymize-accounts");
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastRunSucceeded).toBe(true);

    const [run] = await db
      .select()
      .from(jobRun)
      .where(eq(jobRun.jobName, "anonymize-accounts"))
      .orderBy(jobRun.startedAt)
      .limit(1);
    expect(run!.itemCount).toBe(1);
  });
});
