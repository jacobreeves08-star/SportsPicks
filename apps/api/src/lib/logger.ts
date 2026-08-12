import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "sports-pickem-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
