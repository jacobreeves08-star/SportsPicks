import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The auth-gated-routing round trip (Epic 10 brief: redirect an
 * unauthenticated user to login and return them EXACTLY where they
 * were afterward, including query params). Extends
 * e2e/lock-transition.spec.ts's established real-API-and-Postgres
 * harness pattern — this is the hardest-to-retrofit case for the same
 * reason that one is: once a real login screen exists (Epic 11) it
 * becomes much more awkward to isolate "does the GUARD preserve the
 * full path+query" from "does the LOGIN FORM work," so this test
 * covers the guard's own contract now, independent of any screen.
 *
 * No login screen exists yet to click through, so the second half of
 * the round trip is driven the same way lock-transition.spec.ts drives
 * its own harness setup: land on a public, same-origin page first
 * (`/join`, which has no auth guard) to set `localStorage` real tokens
 * on BEFORE navigating to the target — mirroring exactly what
 * `routes/post-login-redirect.ts`'s `navigateAfterLogin` will do once
 * Epic 11's login screen calls it after a real login mutation resolves.
 */

const API_BASE = "http://localhost:3000";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Same argument-array + first-line-only convention as
 * lock-transition.spec.ts's `psql` helper — see that file's own doc
 * comment for why both matter (shell-quoting safety, and psql's
 * command-completion tag landing on a second line even with `-t`). */
function psql(sql: string): string {
  const output = execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "sports_pickem_dev", "-t", "-A", "-c", sql],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return (output.split("\n")[0] ?? "").trim();
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

test("an unauthenticated visit to a protected route redirects to /login, preserving the full path and query", async ({
  page,
}) => {
  // No league needs to exist for this half — authenticatedLayoutRoute's
  // beforeLoad guard is the PARENT of every league-scoped route, so it
  // fires before any data-dependent code runs, real league or not.
  await page.goto("/leagues/league-1/standings?range=week");

  await expect(page).toHaveURL(/\/login\?returnTo=/);
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  expect(returnTo).toBe("/leagues/league-1/standings?range=week");
});

test("once authenticated, the exact preserved returnTo destination is reachable — no bounce back to /login", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const email = `e2e-auth-redirect-${suffix}@example.com`;

  const signupRes = await request.post(`${API_BASE}/auth/signup`, {
    data: { email, password: "password123", displayName: "E2E Redirect", timezone: "UTC" },
  });
  expect(signupRes.ok()).toBe(true);
  psql(`update "user" set email_verified_at = now() where email = '${email}'`);

  const loginRes = await request.post(`${API_BASE}/auth/login`, { data: { email, password: "password123" } });
  expect(loginRes.ok()).toBe(true);
  const tokens = (await loginRes.json()) as AuthTokens;

  // `/join` is public (no auth guard) — a same-origin landing spot to
  // set localStorage on before the real navigation, same reasoning as
  // lock-transition.spec.ts's harness.html detour.
  await page.goto("/join");
  await page.evaluate((t: AuthTokens) => {
    localStorage.setItem("sports-pickem:auth", JSON.stringify(t));
  }, tokens);

  // The exact returnTo captured by the first test — proving the guard's
  // OWN redirect target is genuinely reachable once authenticated, not
  // just that some protected route is.
  await page.goto("/profile");

  await expect(page).toHaveURL("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  // The shell itself mounted, not just the screen — confirms the guard
  // routed through authenticatedLayoutRoute's AppShell, not some other
  // path that happens to also render a "Profile" heading.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});
