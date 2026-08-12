import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { verificationToken } from "../db/schema.js";
import { env } from "./env.js";
import { nowUtc } from "./time.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

export type VerificationPurpose = "email_verify" | "email_change" | "password_reset";

const TTL_HOURS: Record<VerificationPurpose, number> = {
  email_verify: env.AUTH_EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
  email_change: env.AUTH_EMAIL_CHANGE_TOKEN_TTL_HOURS,
  password_reset: env.AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES / 60,
};

/**
 * Invalidates the user's prior unconsumed tokens of this purpose first,
 * so only the most recently issued link of each kind is ever valid —
 * see docs/data-model.md's "decisions beyond literal spec".
 */
export async function issueVerificationToken(userId: string, purpose: VerificationPurpose): Promise<string> {
  await db
    .delete(verificationToken)
    .where(
      and(
        eq(verificationToken.userId, userId),
        eq(verificationToken.purpose, purpose),
        isNull(verificationToken.consumedAt),
      ),
    );

  const rawToken = generateOpaqueToken();
  const expiresAt = nowUtc().plus({ hours: TTL_HOURS[purpose] }).toJSDate();

  await db.insert(verificationToken).values({
    userId,
    purpose,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return rawToken;
}

/**
 * Validates a token for the given purpose (wrong purpose = not found,
 * not just "wrong" — a token is only ever valid for the purpose it was
 * issued under), marks it consumed, and returns the owning userId. Null
 * for any invalid/expired/already-consumed token.
 */
export async function consumeVerificationToken(
  rawToken: string,
  purpose: VerificationPurpose,
): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const now = nowUtc().toJSDate();

  const [existing] = await db
    .select()
    .from(verificationToken)
    .where(
      and(
        eq(verificationToken.tokenHash, tokenHash),
        eq(verificationToken.purpose, purpose),
        isNull(verificationToken.consumedAt),
        gt(verificationToken.expiresAt, now),
      ),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  await db.update(verificationToken).set({ consumedAt: now }).where(eq(verificationToken.id, existing.id));

  return existing.userId;
}

/** Used by the anonymize-accounts job to clean up an anonymized user's
 * outstanding tokens. */
export async function deleteAllVerificationTokensForUser(userId: string): Promise<void> {
  await db.delete(verificationToken).where(eq(verificationToken.userId, userId));
}
