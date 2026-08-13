import { ApiError, networkError } from "../api/errors.js";
import type { WrittenPick } from "../api/types.js";

/**
 * Offline write queue for pick writes (Epic 8 brief — "this app gets
 * used on bar wifi"). Framework-agnostic persistence + retry logic,
 * same split as time/server-clock.ts vs time/use-clock.ts —
 * offline/use-offline-queue.ts wires this to React/the query cache/
 * browser online events; this file has no dependency on any of those,
 * so it's directly unit-testable.
 *
 * The one rule everything here is built around: **the queue must
 * never imply safety.** Queuing a write is not sending it, and even a
 * successfully SENT write can still come back rejected (a pick queued
 * at 6:58 for a 7:00 kickoff, sent once wifi returns at 7:05, is
 * correctly PICK_LOCKED — the server is still the only truth). Nothing
 * in this module marks an entry "done" until the server has actually
 * said so, and a terminal rejection is recorded and surfaced
 * explicitly, never silently dropped.
 */

export type QueueEntryStatus = "pending" | "sending" | "failed";

export interface QueuedPickWrite {
  id: string;
  leagueId: string;
  memberId: string;
  gameId: string;
  selectedTeam: string;
  /** Cache-targeting only, mirrors mutations/use-pick-mutation.ts's
   * same field — the write endpoint itself takes no date. */
  date?: string;
  /** What this game's pick showed immediately before this entry was
   * queued — captured by the caller (offline/use-offline-queue.ts) at
   * enqueue time from its own query cache, NOT computed here (this
   * module has no query-client dependency by design). Needed so a
   * confirmed rejection, once the entry is finally sent, can revert
   * the optimistic "unsaved" fill back to the true prior value instead
   * of guessing `null` — mirrors mutations/use-pick-mutation.ts's own
   * `revertedTo` for exactly the same reason. */
  previousSelectedTeam: string | null;
  queuedAt: number;
  attempts: number;
  status: QueueEntryStatus;
  lastError: { code: string; message: string } | null;
}

const STORAGE_KEY = "sports-pickem:offline-pick-queue";

function readFromStorage(): QueuedPickWrite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedPickWrite[]) : [];
  } catch {
    // Corrupt/unavailable storage — an empty queue is the safe
    // fallback (never crash a module load over this), matching
    // api/auth-store.ts's same defensive posture.
    return [];
  }
}

let queue: QueuedPickWrite[] = typeof localStorage !== "undefined" ? readFromStorage() : [];
const listeners = new Set<(queue: QueuedPickWrite[]) => void>();
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* storage unavailable/full — in-memory queue is still correct for
     * the rest of this session; just won't survive a reload. */
  }
  for (const listener of listeners) listener(queue);
}

export function getQueue(): QueuedPickWrite[] {
  return queue;
}

export function subscribeToQueue(listener: (queue: QueuedPickWrite[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `offline-pick-${Date.now()}-${idCounter}`;
}

/**
 * Queues a pick write. A new call for the SAME (league, member, game)
 * as an existing queued entry — pending, sending, or even already
 * failed — REPLACES it rather than piling up a second entry: only the
 * latest selection the user actually wants matters, sending stale
 * intermediate values in order serves no one, and a user retrying
 * after a failure should always get a genuinely fresh attempt (reset
 * to pending, zero attempts), not be stuck behind their own old
 * failure record.
 */
export function enqueuePickWrite(input: {
  leagueId: string;
  memberId: string;
  gameId: string;
  selectedTeam: string;
  date?: string;
  previousSelectedTeam: string | null;
}): QueuedPickWrite {
  const entry: QueuedPickWrite = {
    id: nextId(),
    leagueId: input.leagueId,
    memberId: input.memberId,
    gameId: input.gameId,
    selectedTeam: input.selectedTeam,
    date: input.date,
    previousSelectedTeam: input.previousSelectedTeam,
    queuedAt: Date.now(),
    attempts: 0,
    status: "pending",
    lastError: null,
  };

  queue = [
    ...queue.filter(
      (existing) =>
        !(existing.leagueId === input.leagueId && existing.memberId === input.memberId && existing.gameId === input.gameId),
    ),
    entry,
  ];
  persist();
  return entry;
}

/** Explicit acknowledgment of a failed entry — the only way a
 * "failed" entry leaves the queue short of a fresh `enqueuePickWrite`
 * superseding it. Mirrors mutations/use-pick-mutation.ts's
 * `dismissRejection` — nothing here self-clears. */
export function dismissFailedEntry(id: string): void {
  queue = queue.filter((entry) => entry.id !== id);
  persist();
}

function updateEntry(id: string, patch: Partial<QueuedPickWrite>): void {
  queue = queue.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  persist();
}

/**
 * `attempts` is the count of failures SO FAR (already incremented by
 * the caller before this runs). Standard exponential backoff: the
 * retry following the 1st failure waits `base` (1s, near-instant —
 * often just a momentary blip), the retry following the 2nd waits
 * `2*base`, and so on, capped at 30s. Using `attempts` directly
 * (rather than `attempts - 1`) would make the FIRST retry already wait
 * 2s — measurably slower to recover from a one-off blip for no benefit.
 */
function backoffDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), 30_000);
}

export interface QueueFlushDeps {
  write: (entry: QueuedPickWrite) => Promise<WrittenPick>;
  onEntrySucceeded?: (entry: QueuedPickWrite, result: WrittenPick) => void;
  onEntryFailed?: (entry: QueuedPickWrite, error: ApiError) => void;
}

/**
 * Attempts every PENDING entry in order. A network-level failure
 * (still offline, or a transient blip) puts that entry back to
 * pending, bumps its attempt count, schedules a backoff retry, and
 * stops the rest of this pass immediately — every other entry would
 * fail identically right now, so there's no point burning through
 * them one by one. A genuine, explicit rejection from the server
 * (PICK_LOCKED, GAME_CANCELED, etc.) is terminal for THAT entry only:
 * marked "failed" with the real reason, left in the queue for a
 * caller to explicitly acknowledge, and the pass continues to the
 * next entry — one member's stale pick shouldn't block another
 * game's still-valid one.
 */
export async function flushQueue(deps: QueueFlushDeps): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const entry of queue.filter((e) => e.status === "pending")) {
      updateEntry(entry.id, { status: "sending" });
      try {
        const result = await deps.write(entry);
        queue = queue.filter((e) => e.id !== entry.id);
        persist();
        deps.onEntrySucceeded?.(entry, result);
      } catch (err) {
        const apiError = err instanceof ApiError ? err : networkError(err);
        if (apiError.isNetworkFailure) {
          updateEntry(entry.id, { status: "pending", attempts: entry.attempts + 1, lastError: null });
          scheduleRetry(deps);
          return;
        }
        updateEntry(entry.id, { status: "failed", lastError: { code: apiError.code, message: apiError.message } });
        deps.onEntryFailed?.(entry, apiError);
      }
    }
  } finally {
    flushing = false;
  }
}

function scheduleRetry(deps: QueueFlushDeps): void {
  if (retryTimer) return;
  const pending = queue.filter((e) => e.status === "pending");
  if (pending.length === 0) return;
  const maxAttempts = Math.max(...pending.map((e) => e.attempts));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushQueue(deps);
  }, backoffDelayMs(maxAttempts));
}

/** Test-only reset — never call from application code. */
export function resetQueueForTests(): void {
  queue = [];
  listeners.clear();
  flushing = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  idCounter = 0;
}
