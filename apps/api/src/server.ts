import { buildApp } from "./app.js";
import { initErrorTracking } from "./lib/error-tracking.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

initErrorTracking();

const app = buildApp();

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => logger.info({ address }, "api listening"))
  .catch((err) => {
    logger.error({ err }, "failed to start api");
    process.exit(1);
  });
