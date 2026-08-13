# Rate limiting and caching (JAC-43–48)

This is the authoritative spec for every rate limit in the app and the slate-read cache. Implementation: `apps/api/src/lib/rate-limit.ts` (shared `errorResponseBuilder`, the account-wide registration), `apps/api/src/lib/slate-cache.ts` (the cache), and the individual nested plugin registrations in `apps/api/src/routes/*.ts` described below.

## The one thing to understand before touching any of this: `@fastify/rate-limit`'s single-fire-per-request guard

`@fastify/rate-limit` decorates a single boolean flag onto the request object — a `Symbol`, generated once per `app.register(rateLimit, ...)` call — that every check derived from that ONE registration shares. The first check to run on a given request sets that flag; every other check sharing it silently returns without doing anything for the rest of that request. Not a redundant check — no check at all.

This means: a route-level `config.rateLimit` override, and a manually-invoked `app.rateLimit(...)` call added as a second `preHandler`, both derived from the same top-level registration in `app.ts`, do **not** stack into two independent limits. Only the first one to run (in hook-phase order — `onRequest` before `preHandler`) ever actually enforces; the second is inert. This bit this codebase for real: `league-invites.routes.ts`'s `/preview` and `/join` endpoints have had a route-level 20/min-per-IP `config.rateLimit` plus an explicit 10/min-per-user `app.rateLimit()` call since Epic 4, looking like two layered limits. The per-user one has never actually fired — confirmed empirically before fixing it.

**Genuinely independent limits need genuinely independent `app.register(rateLimit, ...)` calls** — each one gets its own fresh guard symbol and its own fresh counting store, and none of them block each other. Every "layered" limit in this app (below) is implemented this way: a small nested plugin (`app.register(async (instance) => { ... })`) wrapping just the route(s) that need the extra layer, with its own `instance.register(rateLimit, { ... })` inside it, relying on that registration's own `global: true` default (no `config.rateLimit` — see next paragraph) to auto-apply to every route declared in that nested scope.

**`config.rateLimit` can't express two different registrations' two different configs**, because every listening registration's own `onRoute` hook reads the exact same shared value and treats it identically as "override MY defaults with this." This is why the fix above didn't just add a second `config.rateLimit`-driven check — it dropped `config.rateLimit` from those two routes entirely, in favor of two real, independent registrations each relying on their own plain default.

**Each independent registration also needs its own `errorResponseBuilder`** — nothing is inherited between registrations, including this. `rateLimitErrorResponseBuilder` (`lib/rate-limit.ts`) is the one shared implementation, passed explicitly to every `app.register(rateLimit, ...)` call in the app; it attaches `retryAfterSeconds` (computed from `context.ttl`, which is milliseconds — not the human-readable `context.after` string) to the standard `RATE_LIMITED` error envelope, so a client can show "try again in Xs."

## The limits, layer by layer

| Layer | Scope | Default | Keyed by | Where |
|---|---|---|---|---|
| Global IP limit | Every route | 100/min | IP | `app.ts` (pre-existing) |
| Account-wide limit | Every authenticated route | 300/min (`ACCOUNT_RATE_LIMIT_PER_MINUTE`) | account | `registerAccountRateLimit` (`lib/rate-limit.ts`), called from every authenticated route file |
| Signup per-minute | `/auth/signup` | 5/min (pre-existing) | IP | nested plugin in `auth.routes.ts` |
| Signup daily | `/auth/signup` | 20/day (`SIGNUP_DAILY_LIMIT_PER_IP`) | IP | same nested plugin |
| Invite-code per-user | `/preview`, `/join` | 10/min (pre-existing, now actually enforced) | account | nested plugin in `league-invites.routes.ts` |
| Pick-write per-member | pick PUT + batch POST | 30/min (`PICK_WRITE_RATE_LIMIT_PER_MINUTE`) | account | nested plugin in `leagues.routes.ts` |
| Slate-poll | `GET /:leagueId/slate` | 20/min (`SLATE_POLL_RATE_LIMIT_PER_MINUTE`) | account | nested plugin in `leagues.routes.ts` |

The account-wide limit exists distinct from the IP limit specifically because an authenticated account hammering from rotating IPs would never trip an IP-keyed limit at all. The per-route limits below it exist because a general 300/min ceiling is too coarse to catch abuse concentrated on one specific, more sensitive action quickly.

## Signup bot protection — no CAPTCHA

No CAPTCHA is implemented — **there is no frontend anywhere in this repo** to render a challenge widget. Two server-side defenses instead:

- **A honeypot field** (`website`, optional string in the signup body). A real signup never includes it (nothing renders it, hidden or otherwise); a scripted client guessing at common field names might. A filled value gets the exact same `201` response as a real signup, with zero side effects — never reveals that anything was detected, the same "never confirm what actually happened" idiom already used for the duplicate-email branch.
- **The daily per-IP limit** above, layered on top of the pre-existing per-minute one — catches slow, steady abuse the per-minute limit alone wouldn't.

### The CAPTCHA contract for a future frontend (documented, not built)

When a real frontend exists, add a `captchaToken` field to the signup request body, populated by a challenge widget (e.g. Cloudflare Turnstile or hCaptcha — either integrates via a simple server-side token-verification API call, no infrastructure of our own to run). The signup route would verify that token against the provider's verification endpoint before proceeding, the same way `isValidIanaTimeZone`/content-filter checks already gate signup today. Until then, the honeypot + daily-limit combination above is the whole defense — documented here so it isn't silently forgotten once a frontend exists.

## Pick-write and slate-poll limits

Both are per-member (`request.user.id`), not per-IP — a household sharing one IP shouldn't be throttled together while one member is legitimately picking a full slate or one member's client is legitimately polling for a live lock transition. Both are nested-plugin registrations scoped to just the routes that need them, wrapping the existing route handlers with no other change to their logic.

## The slate cache

The underlying game/pick data only changes when an ingest job runs (score-poll at its 5-minute fastest) or a member writes a pick — a live slate screen wants to poll far more often than that to catch lock transitions and in-game results promptly, and on a busy Saturday that would hit the DB (and, indirectly, the sports API rate limit schedule-ingest/score-poll share) far harder than necessary. `SLATE_CACHE_TTL_SECONDS` (default 20) caps how stale a response can be.

### Cache key: `(leagueId, date, viewerMemberId)` — caching the output, not the input

The slate query is **not** viewer-independent (`docs/picks-and-locking.md`'s "enforced in the query, not after it"): `myPick` is the caller's own selection, and `otherPicks` excludes the caller and only reveals other members' `selectedTeam` once the game is locked. A cache keyed only by `(leagueId, date)` would either leak the wrong viewer's data or require restructuring the query into a viewer-independent part plus an application-code per-viewer filter applied to every cache hit.

The second option was considered and rejected: it moves the privacy guarantee from one SQL `CASE` expression (already verified against real Postgres) to application code that has to correctly re-redact a cached row on every single hit — a strictly weaker invariant, for a savings that's meaningless at a friend-league's ~20 members. **The cache stores the fully-built, already-redacted response the route constructs** — the exact same object that would have been returned without a cache — keyed per viewer. Membership is still verified (`requireLeagueMembership`) on every request regardless of cache hit or miss, so a stale cached response can never outlive the caller's actual membership.

### Invalidation: write-path eviction, not TTL alone

`writePick()` calls `invalidateLeague(leagueId)` on any accepted write — one choke point covers both the single-pick and batch routes for free. Without this, a member submitting a pick and immediately re-polling the slate would see their own write appear to not have registered for up to `SLATE_CACHE_TTL_SECONDS`. The eviction is coarse (every cached date/viewer for that league, not just the affected game's day) but cheap at this scale, and simpler than computing which day bucket a game's `starts_at` falls into per league timezone just to evict one entry. It's also safe to call even from a nested (batch-endpoint) transaction that could still roll back on some later, unrelated failure — an eviction is never *wrong*, only ever a wasted cache miss on the next read, never stale-but-incorrect data.

**Job-driven changes are deliberately NOT actively invalidated.** A job doesn't cheaply know which leagues cover a game whose sport it just touched, without a reverse lookup that isn't worth the complexity at this scale. This means: **a slate response may lag up to `SLATE_CACHE_TTL_SECONDS` behind a job-driven change** (a game going final, a status update) — but a member's own pick write is always reflected immediately on their very next read, regardless of the TTL. This is the accepted tradeoff, not an oversight.

### In-memory `Map`, not Redis — a known, accepted limitation

No new infrastructure — matches this repo's established low-ops, no-Redis pattern (`docs/adr/0001-stack-selection.md`). Correct for the current single-instance web service. **If the web service ever scales to two or more instances, cache entries diverge across instances and a write on one instance won't invalidate another's** — not fixed now, flagged here so it isn't rediscovered as a surprise later.
