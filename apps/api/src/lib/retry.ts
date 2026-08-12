/**
 * Bounded retry with exponential backoff + jitter, for the ESPN
 * adapter's HTTP calls (JAC-24). Retries transient failures (network
 * errors, 5xx, 429); never retries other 4xx — a bad request won't fix
 * itself by trying again.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Override for tests — avoids real setTimeout delays. */
  sleepFn?: (ms: number) => Promise<void>;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError && err.status !== undefined) {
    // 429 (rate limited) and 5xx are worth retrying; any other 4xx
    // (bad request, not found, etc.) will just fail the same way again.
    return err.status === 429 || err.status >= 500;
  }
  // No status info at all — a network-level failure (timeout, DNS,
  // connection reset). Treat as transient.
  return true;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 500, sleepFn = defaultSleep } = opts;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts || !isRetryable(err)) {
        throw err;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
      await sleepFn(delay);
    }
  }
  // Unreachable — the loop always either returns or throws — but keeps
  // the compiler happy about a guaranteed return type.
  throw new Error("withRetry: unreachable");
}
