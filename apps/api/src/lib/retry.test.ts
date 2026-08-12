import { describe, expect, it, vi } from "vitest";
import { HttpError, withRetry } from "./retry.js";

// No real delays in tests — record what withRetry asked us to wait, but
// resolve immediately.
const instantSleep = vi.fn(async (_ms: number) => {});

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, { sleepFn: instantSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and succeeds on a later attempt", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new HttpError("server error", 503);
      return "recovered";
    });
    const result = await withRetry(fn, { attempts: 3, sleepFn: instantSleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries a 429", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new HttpError("rate limited", 429);
      return "ok";
    });
    await withRetry(fn, { attempts: 3, sleepFn: instantSleep });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-429 4xx — fails immediately on the first attempt", async () => {
    const fn = vi.fn(async () => {
      throw new HttpError("not found", 404);
    });
    await expect(withRetry(fn, { attempts: 3, sleepFn: instantSleep })).rejects.toThrow("not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a plain network error with no status (treated as transient)", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new TypeError("fetch failed");
      return "ok";
    });
    await withRetry(fn, { attempts: 3, sleepFn: instantSleep });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws after exhausting all attempts", async () => {
    const fn = vi.fn(async () => {
      throw new HttpError("still down", 503);
    });
    await expect(withRetry(fn, { attempts: 3, sleepFn: instantSleep })).rejects.toThrow("still down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backs off with increasing delay between attempts", async () => {
    const delays: number[] = [];
    const recordingSleep = async (ms: number) => {
      delays.push(ms);
    };
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new HttpError("down", 503);
      return "ok";
    });
    await withRetry(fn, { attempts: 3, baseDelayMs: 100, sleepFn: recordingSleep });
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(200); // exponential: 2nd delay ~= baseDelay * 2
    expect(delays[1]).toBeGreaterThan(delays[0]!);
  });
});
