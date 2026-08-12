/**
 * ApiError -> the error envelope documented in docs/api-conventions.md.
 * Throw this from route handlers for expected, client-facing failures
 * (bad input, not found, etc.) with a stable machine-readable `code`.
 * Anything else that reaches the error handler is treated as unexpected
 * and reported as a generic 500 — its real message/stack are logged and
 * sent to error tracking, never exposed to the client.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly fields?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Array<{ field: string; message: string }>;
  };
}

interface FastifyLikeError {
  statusCode?: number;
  validation?: Array<{ instancePath: string; message?: string }>;
}

export function toErrorResponse(err: unknown): { statusCode: number; body: ErrorEnvelope } {
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      body: { error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) } },
    };
  }

  const fastifyErr = err as FastifyLikeError;

  if (fastifyErr.validation) {
    return {
      statusCode: fastifyErr.statusCode ?? 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          fields: fastifyErr.validation.map((v) => ({
            field: v.instancePath.replace(/^\//, "") || "(root)",
            message: v.message ?? "invalid",
          })),
        },
      },
    };
  }

  // @fastify/rate-limit throws a plain Error with statusCode 429 and no
  // `validation` — give it its own machine-readable code rather than the
  // generic REQUEST_ERROR fallback, since a client should genuinely
  // handle "back off and retry" differently from an ordinary 4xx.
  if (fastifyErr.statusCode === 429) {
    return {
      statusCode: 429,
      body: { error: { code: "RATE_LIMITED", message: err instanceof Error ? err.message : "Rate limited" } },
    };
  }

  const statusCode =
    fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500
      ? fastifyErr.statusCode
      : 500;

  // Never leak internal error messages/stacks to the client for 5xx —
  // they're already captured via logging + error tracking server-side.
  return {
    statusCode,
    body: {
      error:
        statusCode === 500
          ? { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
          : { code: "REQUEST_ERROR", message: err instanceof Error ? err.message : "Request error" },
    },
  };
}
