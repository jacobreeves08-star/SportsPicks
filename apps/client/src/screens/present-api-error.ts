import { ApiError } from "../api/errors.js";

/**
 * Turns a thrown mutation error into what a form actually needs to
 * show — shared across every screen that submits a form against the
 * real API (auth screens first; league create/join next), so this
 * mapping exists exactly once rather than once per screen.
 * `fieldErrors` and `message` are mutually exclusive in practice: a
 * `VALIDATION_ERROR` with `fields` maps onto specific inputs and has
 * no separate top-level message; everything else (rate-limited, a
 * specific rejection code, network failure, an unrecognized code) is
 * a single top-level message with no field to attach to.
 */
export interface ApiErrorPresentation {
  message: string | undefined;
  fieldErrors: Record<string, string>;
}

export function presentApiError(error: unknown): ApiErrorPresentation {
  if (!(error instanceof ApiError)) {
    return { message: "Something went wrong. Please try again.", fieldErrors: {} };
  }

  if (error.code === "RATE_LIMITED") {
    return {
      message:
        error.retryAfterSeconds !== undefined
          ? `Too many attempts. Try again in ${error.retryAfterSeconds}s.`
          : "Too many attempts. Try again shortly.",
      fieldErrors: {},
    };
  }

  if (error.fields && error.fields.length > 0) {
    const fieldErrors: Record<string, string> = {};
    for (const field of error.fields) fieldErrors[field.field] = field.message;
    return { message: undefined, fieldErrors };
  }

  return { message: error.message, fieldErrors: {} };
}
