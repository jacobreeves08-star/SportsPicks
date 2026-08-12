import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { captureException, initErrorTracking } from "./lib/error-tracking.js";
import { env } from "./lib/env.js";
import { toErrorResponse } from "./lib/http-errors.js";
import { logger } from "./lib/logger.js";

initErrorTracking();

const app = Fastify({
  loggerInstance: logger,
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
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

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => logger.info({ address }, "api listening"))
  .catch((err) => {
    logger.error({ err }, "failed to start api");
    process.exit(1);
  });
