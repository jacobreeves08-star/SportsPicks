import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticateAccessToken } from "../lib/session.js";
import { ApiError } from "../lib/http-errors.js";

/**
 * A preHandler, not a global hook — applied per-route via
 * `{ preHandler: authenticate }` so protection is explicit at each route
 * rather than relying on remembering to add an exclusion list.
 *
 * Every failure mode (missing header, malformed header, unknown/expired/
 * revoked token) throws the SAME error: one code, one message. This is
 * deliberate (see docs/api-conventions.md) — the client has exactly one
 * thing to key off of ("not authenticated, go log in"), and it never
 * distinguishes "your token expired" from "that token never existed",
 * which would otherwise leak information about token validity.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    throw new ApiError("UNAUTHENTICATED", "Authentication required", 401);
  }

  const authed = await authenticateAccessToken(token);
  if (!authed) {
    throw new ApiError("UNAUTHENTICATED", "Authentication required", 401);
  }

  request.user = { id: authed.userId, sessionId: authed.sessionId };
}

/**
 * `authenticate`'s never-reject counterpart — populates `request.user`
 * when a valid Bearer token is present, otherwise leaves it unset and
 * lets the request through regardless. Exists for exactly one route
 * (`GET /leagues/preview`, league-invites.routes.ts): a real invite
 * link must show its preview to a visitor who has no account yet at
 * all (Epic 11 brief — "preview -> signup -> auto-join"), while an
 * ALREADY-logged-in caller hitting the same route should still get an
 * accurate `alreadyMember`. Every OTHER route in this app should keep
 * using `authenticate` — this is deliberately not the default.
 */
export async function optionalAuthenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return;

  const authed = await authenticateAccessToken(token);
  if (authed) {
    request.user = { id: authed.userId, sessionId: authed.sessionId };
  }
}
