import type { FastifyInstance } from "fastify";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, league, leagueMember, pick, user } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { createEmailProvider } from "../lib/email-provider.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/http-errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { revokeAllSessionsForUser } from "../lib/session.js";
import { isValidIanaTimeZone, nowUtc } from "../lib/time.js";
import { issueVerificationToken } from "../lib/verification-tokens.js";

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

// Explicit column list, never `select *` — the whole point is that
// password_hash can never accidentally leak into a response.
const PUBLIC_PROFILE_COLUMNS = {
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  timezone: user.timezone,
  avatarUrl: user.avatarUrl,
  emailVerifiedAt: user.emailVerifiedAt,
  pendingEmail: user.pendingEmail,
  deletionRequestedAt: user.deletionRequestedAt,
  scheduledDeletionAt: user.scheduledDeletionAt,
  createdAt: user.createdAt,
};

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/me", async (request) => {
    const [profile] = await db.select(PUBLIC_PROFILE_COLUMNS).from(user).where(eq(user.id, request.user!.id)).limit(1);
    return profile;
  });

  app.patch(
    "/me",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            displayName: { type: "string", minLength: 1 },
            avatarUrl: { type: "string", format: "uri" },
            timezone: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { displayName, avatarUrl, timezone } = request.body as {
        displayName?: string;
        avatarUrl?: string;
        timezone?: string;
      };

      if (timezone !== undefined && !isValidIanaTimeZone(timezone)) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "timezone", message: "must be a valid IANA time zone" },
        ]);
      }

      const updates: Partial<typeof user.$inferInsert> = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
      if (timezone !== undefined) updates.timezone = timezone;

      await db.update(user).set(updates).where(eq(user.id, request.user!.id));

      const [profile] = await db.select(PUBLIC_PROFILE_COLUMNS).from(user).where(eq(user.id, request.user!.id)).limit(1);

      return {
        ...profile,
        ...(timezone !== undefined && {
          warning: "Changing your timezone affects when picks lock for you going forward.",
        }),
      };
    },
  );

  app.post(
    "/me/email",
    {
      schema: {
        body: {
          type: "object",
          required: ["newEmail"],
          properties: { newEmail: { type: "string", pattern: EMAIL_PATTERN } },
        },
      },
    },
    async (request) => {
      const { newEmail } = request.body as { newEmail: string };
      const normalized = newEmail.trim().toLowerCase();

      // Same enumeration-resistance logic as signup (JAC-13): always the
      // same response, silently skip if the address is already in use by
      // someone else (as either their current or pending email).
      const [conflict] = await db
        .select()
        .from(user)
        .where(
          and(ne(user.id, request.user!.id), or(eq(user.email, normalized), eq(user.pendingEmail, normalized))),
        )
        .limit(1);

      if (!conflict) {
        await db.update(user).set({ pendingEmail: normalized }).where(eq(user.id, request.user!.id));
        const token = await issueVerificationToken(request.user!.id, "email_change");
        await createEmailProvider().sendEmailChangeVerification(
          normalized,
          `${env.PUBLIC_API_URL}/auth/verify-email-change?token=${encodeURIComponent(token)}`,
        );
      }

      return { message: "Check your new email to confirm the change." };
    },
  );

  app.post(
    "/me/change-password",
    {
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (request) => {
      const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };

      const [existing] = await db.select().from(user).where(eq(user.id, request.user!.id)).limit(1);
      if (!existing || !(await verifyPassword(existing.passwordHash, currentPassword))) {
        throw new ApiError("CURRENT_PASSWORD_INCORRECT", "Current password is incorrect", 401);
      }

      await db.update(user).set({ passwordHash: await hashPassword(newPassword) }).where(eq(user.id, existing.id));
      // Revoke every OTHER session, but not the one making this request
      // — decision 9: a deliberate, authenticated password change
      // shouldn't log you out of the device you just used.
      await revokeAllSessionsForUser(existing.id, request.user!.sessionId);

      return { message: "Password changed" };
    },
  );

  app.get("/me/export", async (request) => {
    const userId = request.user!.id;

    const [profile] = await db.select(PUBLIC_PROFILE_COLUMNS).from(user).where(eq(user.id, userId)).limit(1);

    const memberships = await db
      .select({
        leagueId: league.id,
        leagueName: league.name,
        role: leagueMember.role,
        joinedAt: leagueMember.joinedAt,
      })
      .from(leagueMember)
      .innerJoin(league, eq(league.id, leagueMember.leagueId))
      .where(eq(leagueMember.userId, userId));

    const picks = await db
      .select({
        leagueId: leagueMember.leagueId,
        gameId: game.id,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        selectedTeam: pick.selectedTeam,
        createdAt: pick.createdAt,
      })
      .from(pick)
      .innerJoin(leagueMember, eq(leagueMember.id, pick.leagueMemberId))
      .innerJoin(game, eq(game.id, pick.gameId))
      .where(eq(leagueMember.userId, userId));

    return { profile, memberships, picks };
  });

  app.post("/me/deletion-request", async (request) => {
    const userId = request.user!.id;
    const scheduledDeletionAt = nowUtc().plus({ days: env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS }).toJSDate();

    await db
      .update(user)
      .set({ deletionRequestedAt: nowUtc().toJSDate(), scheduledDeletionAt })
      .where(eq(user.id, userId));

    // No exception — deletion revokes every session, including this
    // request's own (decision 10). Logging back in during the grace
    // period is itself sufficient to reach deletion-cancel below.
    await revokeAllSessionsForUser(userId);

    return { message: "Account scheduled for deletion", scheduledDeletionAt };
  });

  app.post("/me/deletion-cancel", async (request) => {
    const userId = request.user!.id;
    const [existing] = await db.select().from(user).where(eq(user.id, userId)).limit(1);

    if (existing?.anonymizedAt) {
      throw new ApiError("REQUEST_ERROR", "This account has already been deleted", 409);
    }

    await db
      .update(user)
      .set({ deletionRequestedAt: null, scheduledDeletionAt: null })
      .where(eq(user.id, userId));

    return { message: "Deletion canceled" };
  });
}
