import { logger } from "./logger.js";

/**
 * Dead-man's-switch ping for a scheduled job — the DEDICATED job-failure
 * alert (JAC-11). Point the URL at a monitor that alerts you both when
 * it receives an explicit "/fail" ping AND when it simply doesn't hear
 * from the job within the expected window (e.g. healthchecks.io: GET the
 * URL on success, GET "<url>/fail" on failure). That second case — the
 * job silently not running at all — is exactly the failure mode a plain
 * try/catch + error tracker would miss: standings quietly stop updating
 * while everything else looks healthy.
 *
 * Each scheduled job gets its own monitor URL (e.g. HEARTBEAT_URL for
 * score-poll, ANONYMIZATION_HEARTBEAT_URL for anonymize-accounts) —
 * they run on different schedules, so sharing one monitor would make
 * "did it run on time" meaningless for both. The caller passes the URL
 * rather than this module reading one fixed env var.
 *
 * Best-effort: a network blip hitting the monitor must never crash the
 * job or mask the real error, so failures here are logged, not thrown.
 */
export async function pingHeartbeat(url: string | undefined, status: "success" | "fail"): Promise<void> {
  if (!url) return;

  const target = status === "success" ? url : `${url}/fail`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(target, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    logger.warn({ err, status }, "heartbeat ping failed (job result itself is unaffected)");
  }
}
