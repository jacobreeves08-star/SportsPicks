import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The hardest-to-retrofit e2e test (Epic 8 brief): open a slate,
 * advance server time past a game's start, assert the control locks
 * in the UI and that a late write is rejected by the API with the
 * expected error code.
 *
 * Runs against the REAL API and REAL local Postgres, not a mock — the
 * one thing actually worth an e2e test here is that the server's own
 * lock decision (`now() >= starts_at`, docs/picks-and-locking.md) and
 * the CLIENT's independently-derived `GameState` (game-state/game-state.ts)
 * genuinely agree at the moment it matters. A mocked API could only
 * ever prove the client agrees with itself.
 *
 * "Advance server time" is done by waiting for REAL time to pass a
 * near-future `starts_at`, not by faking the clock — this API has no
 * admin "set the clock" endpoint (nor should it grow one just for a
 * test), so a few seconds of real wall-clock wait is the honest way
 * to observe a live transition, same as what an actual user
 * experiences watching a countdown hit zero.
 *
 * Drives src/e2e-harness/lock-transition-harness.tsx (harness.html) —
 * a test-only page, not a product screen; see that file's own comment
 * for why it exists and why it's kept out of the real app entirely.
 */

const API_BASE = "http://localhost:3000";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * `execFileSync` with an argument ARRAY, not `execSync` with an
 * interpolated shell string — avoids any shell-quoting hazard when
 * `sql` itself contains quotes.
 *
 * Returns only the FIRST LINE of psql's output. Confirmed empirically
 * (`docker compose exec ... psql -t -A -c "insert ... returning id"`,
 * inspected byte-for-byte): even with `-t`/`--tuples-only`, an
 * `INSERT ... RETURNING` prints the returned value on one line
 * followed by psql's own command-completion tag ("INSERT 0 1") on a
 * second — `-t` only suppresses SELECT-style headers/row-count
 * footers, never a command tag. A caller that naively captured the
 * WHOLE trimmed output (as this file's first version did) got a
 * silently two-line "id" that matched nothing — a bare shell variable
 * expansion masks this (unquoted word-splitting on the embedded
 * newline silently drops the second line), which is exactly how this
 * went unnoticed during manual `curl`-based debugging earlier in this
 * same investigation before being caught here.
 */
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

test("a live lock transition: client-derived state flips SCHEDULED -> LOCKED, and a late write is rejected with PICK_LOCKED", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const email = `e2e-lock-${suffix}@example.com`;

  // Seed a real, verified user via the real signup endpoint — email
  // verification itself is covered by apps/api's own test suite, not
  // re-tested here; the DB is the fastest honest way past it.
  const signupRes = await request.post(`${API_BASE}/auth/signup`, {
    data: { email, password: "password123", displayName: "E2E Harness", timezone: "UTC" },
  });
  expect(signupRes.ok()).toBe(true);
  psql(`update "user" set email_verified_at = now() where email = '${email}'`);

  const loginRes = await request.post(`${API_BASE}/auth/login`, { data: { email, password: "password123" } });
  expect(loginRes.ok()).toBe(true);
  const tokens = (await loginRes.json()) as AuthTokens;

  const leagueRes = await request.post(`${API_BASE}/leagues`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    data: { name: `E2E Lock League ${suffix}`, sports: ["nfl"], timezone: "UTC", seasonStart: "2025-09-04" },
  });
  expect(leagueRes.ok()).toBe(true);
  const league = (await leagueRes.json()) as { id: string };

  const memberId = psql(`select id from league_member where league_id = '${league.id}' limit 1`);
  expect(memberId).not.toBe("");

  // A game locking 6 real seconds from now — no API creates a game
  // directly (only schedule-ingest/score-poll do), so this is seeded
  // straight into Postgres, same as this session's established
  // pattern for exercising job/lock behavior without waiting for a
  // real NFL Sunday.
  const gameId = psql(
    `insert into game (sport, home_team, away_team, starts_at, status) values ('nfl', 'Harness Bills', 'Harness Jets', now() + interval '6 seconds', 'scheduled') returning id`,
  );
  expect(gameId).not.toBe("");

  // Land on the harness's own origin first (no query params, so it
  // attempts no fetch yet) purely to get a same-origin page to set
  // localStorage on BEFORE the real navigation — setting it after the
  // component has already mounted and fetched once would race an
  // unauthenticated first request.
  await page.goto("/harness.html");
  await page.evaluate((t: AuthTokens) => {
    localStorage.setItem("sports-pickem:auth", JSON.stringify(t));
  }, tokens);

  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/harness.html?leagueId=${league.id}&memberId=${memberId}&gameId=${gameId}&date=${today}`);

  const stateText = page.getByTestId("game-state");
  await expect(stateText).toHaveText("SCHEDULED", { timeout: 10_000 });

  // The actual wait: real time passing the game's real start. The
  // harness's own clock tick (250ms, see its doc comment) recomputes
  // GameState continuously from already-fetched data — this doesn't
  // depend on a new poll landing at exactly the right moment.
  await expect(stateText).toHaveText("LOCKED", { timeout: 15_000 });

  // The late write — the exact same client code (mutations/use-pick-mutation.ts)
  // a real pick-flow screen will use once one exists — must be
  // rejected by the server, not silently accepted just because the
  // client-side control still looked interactive a moment ago.
  await page.getByTestId("write-pick").click();
  await expect(page.getByTestId("rejection-code")).toHaveText("PICK_LOCKED", { timeout: 10_000 });

  // Best-effort cleanup — matches this session's established
  // tolerance for leftover local dev/test data rather than blocking
  // the test's pass/fail on it.
  await request
    .delete(`${API_BASE}/leagues/${league.id}`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })
    .catch(() => {});
});
