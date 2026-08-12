import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { captureException } from "./lib/error-tracking.js";
import { toErrorResponse } from "./lib/http-errors.js";
import { logger } from "./lib/logger.js";
import { authRoutes } from "./routes/auth.routes.js";
import { usersRoutes } from "./routes/users.routes.js";
import { leaguesRoutes } from "./routes/leagues.routes.js";
import { leagueInvitesRoutes } from "./routes/league-invites.routes.js";
import { healthRoutes } from "./routes/health.routes.js";

/**
 * Factory, separate from server.ts's .listen() call, so tests can build
 * an app instance and use Fastify's app.inject() (no port binding) —
 * see docs/api-conventions.md and the JAC-17 authorization tests.
 */
export function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    // Required for @fastify/rate-limit to see the real client IP behind
    // Render's proxy — without it, request.ip resolves to the proxy's
    // own address, and rate limiting is either broken or effectively
    // global across every client.
    trustProxy: true,
  });

  app.decorateRequest("user", null);

  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Every error response uses the envelope documented in
  // docs/api-conventions.md — see lib/http-errors.ts.
  app.setErrorHandler((err, _request, reply) => {
    const { statusCode, body } = toErrorResponse(err);
    if (statusCode >= 500) captureException(err);
    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // Liveness/uptime-check target — see docs/observability.md for the
  // external monitor pinging this on a schedule.
  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(usersRoutes, { prefix: "/users" });
  app.register(leaguesRoutes, { prefix: "/leagues" });
  app.register(leagueInvitesRoutes, { prefix: "/leagues" });
  app.register(healthRoutes);

  return app;
}
