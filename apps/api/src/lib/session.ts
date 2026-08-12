import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { session } from "../db/schema.js";
import { env } from "./env.js";
import { nowUtc } from "./time.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

function newExpiries() {
  const now = nowUtc();
  return {
    accessTokenExpiresAt: now.plus({ minutes: env.AUTH_ACCESS_TOKEN_TTL_MINUTES }).toJSDate(),
    // Sliding: always computed from *now*, not the previous expiry, so an
    // actively-returning user's session never approaches expiry.
    refreshTokenExpiresAt: now.plus({ days: env.AUTH_REFRESH_TOKEN_TTL_DAYS }).toJSDate(),
  };
}

export async function createSession(userId: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const { accessTokenExpiresAt, refreshTokenExpiresAt } = newExpiries();

  await db.insert(session).values({
    userId,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
}

/**
 * Validates and rotates a refresh token: issues a new access+refresh pair,
 * overwrites the stored hashes, and extends refresh_token_expires_at from
 * now (the sliding window). The old refresh token stops working the
 * instant this succeeds — reusing it afterward fails lookup like any
 * other invalid token. Returns null for any invalid/expired/revoked
 * token; callers should respond with one generic error either way.
 */
export async function rotateSession(rawRefreshToken: string): Promise<IssuedTokens | null> {
  const refreshTokenHash = hashToken(rawRefreshToken);
  const now = nowUtc().toJSDate();

  const [existing] = await db
    .select()
    .from(session)
    .where(
      and(eq(session.refreshTokenHash, refreshTokenHash), isNull(session.revokedAt), gt(session.refreshTokenExpiresAt, now)),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const { accessTokenExpiresAt, refreshTokenExpiresAt } = newExpiries();

  await db
    .update(session)
    .set({
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      lastUsedAt: nowUtc().toJSDate(),
    })
    .where(eq(session.id, existing.id));

  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
}

export interface AuthenticatedSession {
  userId: string;
  sessionId: string;
}

export async function authenticateAccessToken(rawAccessToken: string): Promise<AuthenticatedSession | null> {
  const accessTokenHash = hashToken(rawAccessToken);
  const now = nowUtc().toJSDate();

  const [existing] = await db
    .select()
    .from(session)
    .where(
      and(eq(session.accessTokenHash, accessTokenHash), isNull(session.revokedAt), gt(session.accessTokenExpiresAt, now)),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  await db.update(session).set({ lastUsedAt: now }).where(eq(session.id, existing.id));

  return { userId: existing.userId, sessionId: existing.id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(session).set({ revokedAt: nowUtc().toJSDate() }).where(eq(session.id, sessionId));
}

/** Logout-everywhere (or password-reset-invalidates-all-sessions). Pass
 * exceptSessionId to keep the current device's session alive (used by
 * the authenticated password-change flow — see docs/adr/0002). */
export async function revokeAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
  const conditions = [eq(session.userId, userId), isNull(session.revokedAt)];
  if (exceptSessionId) {
    conditions.push(ne(session.id, exceptSessionId));
  }
  await db
    .update(session)
    .set({ revokedAt: nowUtc().toJSDate() })
    .where(and(...conditions));
}
