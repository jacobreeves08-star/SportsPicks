import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit, { type errorResponseBuilderContext } from "@fastify/rate-limit";
import { env } from "./env.js";

/**
 * Shared `errorResponseBuilder` for EVERY `@fastify/rate-limit`
 * registration in this app (app.ts's root registration,
 * `registerAccountRateLimit` below, and any other independent
 * registration — see that function's comment for why there's more than
 * one). Each registration has its own, entirely independent config —
 * nothing is inherited from another registration, including this
 * builder — so it must be passed explicitly every time, not just once
 * at the root. `context.ttl` is milliseconds remaining, NOT the
 * human-readable `context.after` string.
 */
export function rateLimitErrorResponseBuilder(
  _req: FastifyRequest,
  context: errorResponseBuilderContext,
): Error & { statusCode: number; retryAfterSeconds: number } {
  const err = new Error(`Rate limit exceeded, retry in ${context.after}`) as Error & {
    statusCode: number;
    retryAfterSeconds: number;
  };
  err.statusCode = context.statusCode;
  err.retryAfterSeconds = Math.ceil(context.ttl / 1000);
  return err;
}

/**
 * Per-account rate limiting (JAC-43-48), distinct from the existing
 * global IP-keyed limit (`app.ts`) — an authenticated account hammering
 * from rotating IPs would never trip an IP-keyed limit at all. Keyed by
 * `request.user.id`, so it only ever runs on routes that already run the
 * `authenticate` preHandler first. See docs/rate-limiting-and-caching.md.
 *
 * MUST be a fresh `app.register(rateLimit, ...)` call, not a second
 * `app.rateLimit(...)` invocation off the app-wide plugin already
 * registered in app.ts. Confirmed empirically: every rate-limit check
 * derived from ONE `@fastify/rate-limit` registration — whether the
 * auto-applied global check or any number of manual `app.rateLimit()`
 * calls — shares that registration's single `rateLimitRan` per-request
 * guard (a symbol decorated onto the request exactly once, at plugin-
 * registration time, and inherited by every check spawned from it). The
 * first such check to run on a request sets that shared flag, and every
 * other check sharing it becomes a silent no-op for the rest of that
 * request — not a redundant check, no check at all. Two INDEPENDENT
 * `app.register(rateLimit, ...)` calls each get their own fresh symbol
 * and genuinely both enforce. `hook: "preHandler"` (the plugin defaults
 * to `"onRequest"`, which would run before `authenticate` sets
 * `request.user`, crashing the keyGenerator) relies on Fastify's
 * ordering guarantee that instance-level hooks (`authenticate`, added
 * via `app.addHook`) always run before route-level ones (this plugin's
 * auto-applied per-route hook) within the same phase — registration
 * order relative to `authenticate` doesn't matter.
 */
export async function registerAccountRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => req.user!.id,
    errorResponseBuilder: rateLimitErrorResponseBuilder,
  });
}
