import { describe, expect, it } from "vitest";
import { ApiError, toErrorResponse } from "./http-errors.js";

describe("toErrorResponse", () => {
  it("serializes an ApiError with its own code and status", () => {
    const { statusCode, body } = toErrorResponse(new ApiError("NOT_FOUND", "League not found", 404));
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "League not found" } });
  });

  it("includes field details when the ApiError carries them", () => {
    const { body } = toErrorResponse(
      new ApiError("VALIDATION_ERROR", "Invalid input", 400, [
        { field: "email", message: "must be a valid email" },
      ]),
    );
    expect(body.error.fields).toEqual([{ field: "email", message: "must be a valid email" }]);
  });

  it("maps a Fastify schema-validation error into field details", () => {
    const fastifyValidationErr = {
      statusCode: 400,
      validation: [{ instancePath: "/email", message: "must match format" }],
    };
    const { statusCode, body } = toErrorResponse(fastifyValidationErr);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toEqual([{ field: "email", message: "must match format" }]);
  });

  it("hides the real message behind a generic envelope for unexpected errors", () => {
    const { statusCode, body } = toErrorResponse(new Error("db connection string leaked here"));
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("leaked");
  });

  it("passes through a plain 4xx error message without treating it as internal", () => {
    const err = Object.assign(new Error("Malformed request"), { statusCode: 422 });
    const { statusCode, body } = toErrorResponse(err);
    expect(statusCode).toBe(422);
    expect(body.error).toEqual({ code: "REQUEST_ERROR", message: "Malformed request" });
  });

  it("gives @fastify/rate-limit's 429 its own RATE_LIMITED code, not the generic REQUEST_ERROR", () => {
    // @fastify/rate-limit's default errorResponseBuilder throws exactly
    // this shape: a plain Error with statusCode 429, no `validation`.
    const err = Object.assign(new Error("Rate limit exceeded, retry in 1 minute"), { statusCode: 429 });
    const { statusCode, body } = toErrorResponse(err);
    expect(statusCode).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
