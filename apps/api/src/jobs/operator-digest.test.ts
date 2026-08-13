import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { jobRun } from "../db/schema.js";
import { truncateAllTables } from "../db/test-helpers.js";
import type { EmailProvider } from "../lib/email-provider.js";
import { env } from "../lib/env.js";
import type { OpsSummary } from "../lib/ops-summary.js";
import { runOperatorDigest } from "./operator-digest.js";

function fakeEmailProvider(): EmailProvider & { digestCalls: { to: string; summary: OpsSummary }[] } {
  const digestCalls: { to: string; summary: OpsSummary }[] = [];
  return {
    digestCalls,
    sendVerificationEmail: vi.fn(async () => {}),
    sendEmailChangeVerification: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
    sendDuplicateSignupNotice: vi.fn(async () => {}),
    sendPickReminderEmail: vi.fn(async () => {}),
    sendResultsSummaryEmail: vi.fn(async () => {}),
    sendOperatorDigestEmail: vi.fn(async (to: string, summary: OpsSummary) => {
      digestCalls.push({ to, summary });
    }),
  };
}

describe("runOperatorDigest", () => {
  const originalOperatorEmail = env.OPERATOR_EMAIL;

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterEach(() => {
    env.OPERATOR_EMAIL = originalOperatorEmail;
  });

  it("is a no-op when OPERATOR_EMAIL is unset, but still records a successful job run", async () => {
    env.OPERATOR_EMAIL = undefined;
    const provider = fakeEmailProvider();

    await runOperatorDigest(provider);

    expect(provider.digestCalls).toHaveLength(0);
    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "operator-digest"));
    expect(run).toMatchObject({ succeeded: true, itemCount: 0 });
  });

  it("sends the digest to OPERATOR_EMAIL when set", async () => {
    env.OPERATOR_EMAIL = "ops@example.com";
    const provider = fakeEmailProvider();

    await runOperatorDigest(provider);

    expect(provider.digestCalls).toHaveLength(1);
    expect(provider.digestCalls[0]?.to).toBe("ops@example.com");
    expect(provider.digestCalls[0]?.summary.generatedAt).toBeInstanceOf(Date);
  });

  it("does not send a second digest the same day", async () => {
    env.OPERATOR_EMAIL = "ops@example.com";
    const provider = fakeEmailProvider();

    await runOperatorDigest(provider);
    await runOperatorDigest(provider);

    expect(provider.digestCalls).toHaveLength(1);
  });
});
