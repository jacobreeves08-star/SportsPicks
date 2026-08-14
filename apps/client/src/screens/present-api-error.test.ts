import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors.js";
import { presentApiError } from "./present-api-error.js";

describe("presentApiError", () => {
  it("maps a non-ApiError to a generic top-level message", () => {
    expect(presentApiError(new Error("boom"))).toEqual({
      message: "Something went wrong. Please try again.",
      fieldErrors: {},
    });
  });

  it("includes retryAfterSeconds in the message when present on a RATE_LIMITED error", () => {
    const error = new ApiError({ code: "RATE_LIMITED", message: "Too many requests", retryAfterSeconds: 42 }, 429);
    expect(presentApiError(error).message).toBe("Too many attempts. Try again in 42s.");
  });

  it("falls back to a generic rate-limit message when retryAfterSeconds is absent", () => {
    const error = new ApiError({ code: "RATE_LIMITED", message: "Too many requests" }, 429);
    expect(presentApiError(error).message).toBe("Too many attempts. Try again shortly.");
  });

  it("maps VALIDATION_ERROR fields onto fieldErrors with no top-level message", () => {
    const error = new ApiError(
      {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        fields: [{ field: "timezone", message: "must be a valid IANA time zone" }],
      },
      400,
    );
    expect(presentApiError(error)).toEqual({
      message: undefined,
      fieldErrors: { timezone: "must be a valid IANA time zone" },
    });
  });

  it("falls back to the server's own message for any other code", () => {
    const error = new ApiError({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401);
    expect(presentApiError(error)).toEqual({ message: "Invalid email or password", fieldErrors: {} });
  });
});
