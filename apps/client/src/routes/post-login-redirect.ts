import { homePath } from "./paths.js";
import type { AppRouter } from "./route-tree.js";

/**
 * `returnTo` arrives as a query-string value the USER's browser sent
 * back to us — never trust it as a navigation target without
 * validation. A crafted `?returnTo=https://evil.com` or
 * `?returnTo=//evil.com` (protocol-relative, still an open redirect)
 * must never be honored; only a same-app relative path starting with
 * exactly one `/` is accepted. Used both by `authenticatedLayoutRoute`'s
 * guard (route-tree.tsx) and by `session-redirect.ts` — one place,
 * so the two can't quietly diverge on what counts as "safe."
 */
export function safeReturnTo(returnTo: string | undefined): string {
  if (returnTo && /^\/(?!\/)/.test(returnTo)) return returnTo;
  return homePath();
}

/**
 * Not called by anything in THIS epic — no login screen exists yet
 * (Epic 11 builds it) — but built and tested now so that screen has a
 * proven, stable target to call the moment its login mutation
 * resolves, rather than reverse-engineering intent from a plan doc
 * later. Matches Epic 8's "design before the screen exists" posture.
 */
export function navigateAfterLogin(router: AppRouter, returnTo: string | undefined): Promise<void> {
  return router.navigate({ to: safeReturnTo(returnTo) });
}
