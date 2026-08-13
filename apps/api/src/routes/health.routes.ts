import type { FastifyInstance } from "fastify";
import { getOpsSummary } from "../lib/ops-summary.js";

/**
 * Documented (not yet consumed — no frontend exists in this repo) hook
 * for a future stale-data banner (JAC-24), and a genuinely useful
 * ops-visibility endpoint on its own. No auth, no PII — matches the
 * existing bare /health liveness check's public status. Registered
 * with no prefix; the route paths below are the full paths.
 *
 * JAC-43-48: the response shape grew additively (jobs/staleGameCount/
 * generatedAt were already here; correctionsLast24h/signupsLast24h/
 * picksLast24h/slateCompletionRates are new) — nothing existing was
 * renamed or removed, so this stays backward compatible for anything
 * already reading the original three fields. getOpsSummary() is the
 * single source of truth, shared with the operator-digest.ts email.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/data-freshness", async () => getOpsSummary());
}
