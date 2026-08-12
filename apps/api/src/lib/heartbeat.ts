import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Dead-man's-switch ping for the score-poll job — the DEDICATED
 * job-failure alert (JAC-11). Point HEARTBEAT_URL at a monitor that
 * alerts you both when it receives an explicit "/fail" ping AND when it
 * simply doesn't hear from the job within the expected window (e.g.
 * healthchecks.io: GET the URL on success, GET "<url>/fail" on failure).
 * That second case — the job silently not running at all — is exactly
 * the failure mode a plain try/catch + error tracker would miss:
 * standings quietly stop updating while everything else looks healthy.
 *
 * Best-effort: a network blip hitting the monitor must never crash the
 * job or mask the real error, so failures here are logged, not thrown.
 */
export async function pingHeartbeat(status: "success" | "fail"): Promise<void> {
  if (!env.HEARTBEAT_URL) return;

  const url = status === "success" ? env.HEARTBEAT_URL : `${env.HEARTBEAT_URL}/fail`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    logger.warn({ err, status }, "heartbeat ping failed (job result itself is unaffected)");
  }
}
