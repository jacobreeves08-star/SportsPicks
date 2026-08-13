import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { logEvent } from "../lib/analytics.js";
import { createEmailProvider } from "../lib/email-provider.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/http-errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { rateLimitErrorResponseBuilder } from "../lib/rate-limit.js";
import { createSession, revokeAllSessionsForUser, revokeSession, rotateSession } from "../lib/session.js";
import { nowUtc, isValidIanaTimeZone } from "../lib/time.js";
import { consumeVerificationToken, issueVerificationToken } from "../lib/verification-tokens.js";

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function verificationLink(kind: "verify-email" | "verify-email-change" | "password-reset/confirm", token: string) {
  return `${env.PUBLIC_API_URL}/auth/${kind}?token=${encodeURIComponent(token)}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Signup bot protection (JAC-43-48) — no CAPTCHA (no frontend exists
   * anywhere in this repo to render a challenge widget; see
   * docs/rate-limiting-and-caching.md for the documented contract for a
   * future one). Two independent, layered per-IP limits — the existing
   * 5/min plus a new daily ceiling that catches slow, steady abuse the
   * per-minute limit alone wouldn't — PLUS a honeypot field, all scoped
   * to `/signup` via its own nested plugin.
   *
   * Both limits are separate `app.register(rateLimit, ...)` calls, not
   * a route-level `config.rateLimit` override or a second manual
   * `app.rateLimit()` call off one registration — confirmed empirically
   * (see lib/rate-limit.ts) that every check derived from a SINGLE
   * registration shares one single-fire-per-request guard, so only the
   * first to run would ever actually apply; two genuinely independent
   * registrations are what makes both real. Neither route.rateLimit
   * config is used here for the same reason `config.rateLimit` was
   * dropped from league-invites.routes.ts's /preview and /join: every
   * listening registration reacts to the SAME `config.rateLimit` value
   * identically, so it can't express "registration A uses config X,
   * registration B uses its own config Y" — each of these two
   * registrations instead relies on its own plain default, auto-applied
   * to every route in this nested scope (just this one route).
   */
  await app.register(async (instance) => {
    await instance.register(rateLimit, {
      max: 5,
      timeWindow: "1 minute",
      errorResponseBuilder: rateLimitErrorResponseBuilder,
    });
    await instance.register(rateLimit, {
      max: env.SIGNUP_DAILY_LIMIT_PER_IP,
      timeWindow: "1 day",
      errorResponseBuilder: rateLimitErrorResponseBuilder,
    });

    instance.post(
      "/signup",
      {
        schema: {
          body: {
            type: "object",
            required: ["email", "password", "displayName", "timezone"],
            properties: {
              email: { type: "string", pattern: EMAIL_PATTERN },
              password: { type: "string", minLength: 8 },
              displayName: { type: "string", minLength: 1 },
              // Required, no server-side default — see JAC-13: lock times and
              // daily standings depend on this being right from day one.
              timezone: { type: "string", minLength: 1 },
              // Honeypot — real users never see or fill this (no frontend
              // renders it at all, let alone hidden); a scripted client
              // guessing at common field names might. A non-empty value
              // gets the exact same response as a real signup, with no
              // side effects — never reveals that anything was detected,
              // same idiom as the duplicate-email branch below.
              website: { type: "string" },
            },
          },
        },
      },
      async (request, reply) => {
        const { email, password, displayName, timezone, website } = request.body as {
          email: string;
          password: string;
          displayName: string;
          timezone: string;
          website?: string;
        };

        if (website) {
          reply.status(201);
          return { message: "Check your email to verify your account." };
        }

        if (!isValidIanaTimeZone(timezone)) {
          throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
            { field: "timezone", message: "must be a valid IANA time zone" },
          ]);
        }

        const normalizedEmail = normalizeEmail(email);
        const emailProvider = createEmailProvider();

        const [existing] = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

        if (existing) {
          // Duplicate email: never reveal the account exists. Same
          // response as success below, but notify the EXISTING account
          // instead of creating anything.
          await emailProvider.sendDuplicateSignupNotice(existing.email);
        } else {
          const [created] = await db
            .insert(user)
            .values({ email: normalizedEmail, passwordHash: await hashPassword(password), displayName, timezone })
            .returning();
          const token = await issueVerificationToken(created!.id, "email_verify");
          await emailProvider.sendVerificationEmail(normalizedEmail, verificationLink("verify-email", token));
          await logEvent("user_signed_up", { userId: created!.id });
        }

        reply.status(201);
        return { message: "Check your email to verify your account." };
      },
    );
  });

  app.post(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", pattern: EMAIL_PATTERN },
            password: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { email, password } = request.body as { email: string; password: string };
      const normalizedEmail = normalizeEmail(email);

      const [existing] = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

      // Same error whether the account doesn't exist or the password is
      // wrong — never reveal which. An anonymized account's password_hash
      // is a well-formed but permanently-unusable hash (see
      // docs/account-anonymization.md), so verifyPassword naturally
      // returns false for it with no special-casing needed here.
      if (!existing || !(await verifyPassword(existing.passwordHash, password))) {
        throw new ApiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
      }

      const tokens = await createSession(existing.id, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      return tokens;
    },
  );

  app.post(
    "/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { refreshToken } = request.body as { refreshToken: string };
      const rotated = await rotateSession(refreshToken);

      if (!rotated) {
        throw new ApiError("INVALID_REFRESH_TOKEN", "Invalid or expired refresh token", 401);
      }

      return rotated;
    },
  );

  app.post("/logout", { preHandler: authenticate }, async (request) => {
    await revokeSession(request.user!.sessionId);
    return { message: "Logged out" };
  });

  app.post("/logout-all", { preHandler: authenticate }, async (request) => {
    await revokeAllSessionsForUser(request.user!.id);
    return { message: "Logged out of all devices" };
  });

  app.get(
    "/verify-email",
    { schema: { querystring: { type: "object", required: ["token"], properties: { token: { type: "string" } } } } },
    async (request) => {
      const { token } = request.query as { token: string };
      const userId = await consumeVerificationToken(token, "email_verify");

      if (!userId) {
        throw new ApiError("INVALID_OR_EXPIRED_TOKEN", "Invalid or expired verification link", 400);
      }

      await db.update(user).set({ emailVerifiedAt: nowUtc().toJSDate() }).where(eq(user.id, userId));
      return { message: "Email verified" };
    },
  );

  app.get(
    "/verify-email-change",
    { schema: { querystring: { type: "object", required: ["token"], properties: { token: { type: "string" } } } } },
    async (request) => {
      const { token } = request.query as { token: string };
      const userId = await consumeVerificationToken(token, "email_change");

      if (!userId) {
        throw new ApiError("INVALID_OR_EXPIRED_TOKEN", "Invalid or expired verification link", 400);
      }

      const [existing] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      if (!existing?.pendingEmail) {
        throw new ApiError("INVALID_OR_EXPIRED_TOKEN", "Invalid or expired verification link", 400);
      }

      await db
        .update(user)
        .set({ email: existing.pendingEmail, pendingEmail: null, emailVerifiedAt: nowUtc().toJSDate() })
        .where(eq(user.id, userId));

      return { message: "Email updated" };
    },
  );

  app.post(
    "/password-reset/request",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", pattern: EMAIL_PATTERN } },
        },
      },
    },
    async (request) => {
      const { email } = request.body as { email: string };
      const normalizedEmail = normalizeEmail(email);

      const [existing] = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);
      if (existing) {
        const token = await issueVerificationToken(existing.id, "password_reset");
        await createEmailProvider().sendPasswordResetEmail(
          normalizedEmail,
          verificationLink("password-reset/confirm", token),
        );
      }

      // Identical response whether or not the account exists.
      return { message: "If an account exists for that email, a reset link has been sent." };
    },
  );

  app.post(
    "/password-reset/confirm",
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: { token: { type: "string" }, newPassword: { type: "string", minLength: 8 } },
        },
      },
    },
    async (request) => {
      const { token, newPassword } = request.body as { token: string; newPassword: string };
      const userId = await consumeVerificationToken(token, "password_reset");

      if (!userId) {
        throw new ApiError("INVALID_OR_EXPIRED_TOKEN", "Invalid or expired reset link", 400);
      }

      await db.update(user).set({ passwordHash: await hashPassword(newPassword) }).where(eq(user.id, userId));
      // No exception — a password reset revokes every session, including
      // whichever device this request came from (decision 9).
      await revokeAllSessionsForUser(userId);

      return { message: "Password reset" };
    },
  );
}
