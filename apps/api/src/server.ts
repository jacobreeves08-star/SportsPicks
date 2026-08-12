import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { captureException, initErrorTracking } from "./lib/error-tracking.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

initErrorTracking();

const app = Fastify({
  loggerInstance: logger,
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
});

app.setErrorHandler((err, _request, reply) => {
  captureException(err);
  reply.send(err);
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
