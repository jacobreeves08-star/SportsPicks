import { describe, expect, it } from "vitest";
import { ApiError, networkError, parseError } from "../api/errors.js";
import { shouldRetryQuery } from "./query-client.js";

const apiError = (code: string, status: number) => new ApiError({ code, message: code }, status);

describe("shouldRetryQuery", () => {
  it("retries a network failure — the request never reached the API", () => {
    expect(shouldRetryQuery(0, networkError(new Error("Failed to fetch")))).toBe(true);
  });

  it("retries a body that wasn't the API's envelope — a proxy's error page, not a rejection", () => {
    expect(shouldRetryQuery(0, parseError(502, new SyntaxError("Unexpected token '<'")))).toBe(true);
  });

  it("retries a 500 — nothing about the request says it will fail again", () => {
    expect(shouldRetryQuery(0, apiError("INTERNAL_ERROR", 500))).toBe(true);
  });

  it("gives up after three attempts rather than retrying forever", () => {
    expect(shouldRetryQuery(2, apiError("INTERNAL_ERROR", 500))).toBe(true);
    expect(shouldRetryQuery(3, apiError("INTERNAL_ERROR", 500))).toBe(false);
  });

  it("never retries a 4xx — the request itself is what's wrong", () => {
    expect(shouldRetryQuery(0, apiError("NOT_FOUND", 404))).toBe(false);
    expect(shouldRetryQuery(0, apiError("VALIDATION_ERROR", 400))).toBe(false);
    expect(shouldRetryQuery(0, apiError("RATE_LIMITED", 429))).toBe(false);
  });

  it("never retries a 'not ready' 503, even though it IS a 5xx", () => {
    // The whole point of the exception: the quiz's player pool being
    // unbuilt is not a transient failure, and three backed-off
    // attempts at it are three requests that cannot succeed.
    expect(shouldRetryQuery(0, apiError("TRIVIA_UNAVAILABLE", 503))).toBe(false);
    expect(shouldRetryQuery(0, apiError("TRIVIA_POOL_TOO_SMALL", 503))).toBe(false);
  });

  it("still retries an ordinary 503 — only the not-ready codes are excluded", () => {
    expect(shouldRetryQuery(0, apiError("INTERNAL_ERROR", 503))).toBe(true);
  });

  it("retries a non-ApiError throw, which has no status to reason about", () => {
    expect(shouldRetryQuery(0, new Error("boom"))).toBe(true);
  });
});
