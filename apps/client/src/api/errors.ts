/**
 * Mirrors the error envelope in docs/api-conventions.md /
 * docs/client-api-contract.md exactly: `{ error: { code, message,
 * fields?, retryAfterSeconds? } }` on every non-2xx response. `code` is
 * the only thing application code should ever branch on — never
 * `message` (human-readable, not guaranteed stable) and never the raw
 * HTTP status alone (multiple codes can share one status, e.g. every
 * 409 from picks/leagues).
 */
export interface ApiErrorField {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: ApiErrorField[];
  retryAfterSeconds?: number;
}

/**
 * Every stable error `code` this API is documented to return
 * (docs/api-conventions.md). Kept as a union, not just `string`, so a
 * client `switch` over `.code` gets exhaustiveness checking — but
 * `ApiError.code` itself stays typed as `string` (see below) so a
 * genuinely new server-side code (added without a client release)
 * doesn't fail to parse, just fails to narrow.
 */
export type KnownApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "CURRENT_PASSWORD_INCORRECT"
  | "INVALID_OR_EXPIRED_TOKEN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "REQUEST_ERROR"
  | "INTERNAL_ERROR"
  | "INVITE_CODE_NOT_FOUND"
  | "INVITE_CODE_EXPIRED"
  | "INVITE_CODE_MAX_USES_REACHED"
  | "LEAGUE_FULL"
  | "MAX_LEAGUES_REACHED"
  | "SPORTS_SELECTION_FROZEN"
  | "COMMISSIONER_MUST_TRANSFER_FIRST"
  | "SOLE_MEMBER_USE_DELETE"
  | "CANNOT_REMOVE_SELF"
  | "PICK_LOCKED"
  | "PICK_NOT_YET_OPEN"
  | "GAME_CANCELED"
  | "GAME_POSTPONED"
  | "INVALID_TEAM_SELECTION"
  | "GAME_NOT_FOUND"
  | "RESULT_NOT_FOUND"
  | "NO_CHANGE"
  | "GOLF_PICK_LOCKED"
  | "GOLF_TOURNAMENT_CANCELED"
  | "GOLF_TOURNAMENT_POSTPONED";

/**
 * Thrown by the API client for every non-2xx response and for network-
 * level failures alike (see NETWORK_ERROR/PARSE_ERROR below) — the one
 * exception type every caller in this app catches. `status` is 0 for a
 * failure that never got an HTTP response at all (offline, DNS, CORS),
 * so "no connection" and "server said no" are always distinguishable
 * without a caller needing two different catch shapes.
 */
export class ApiError extends Error {
  readonly code: KnownApiErrorCode | (string & {});
  readonly status: number;
  readonly fields?: ApiErrorField[];
  readonly retryAfterSeconds?: number;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.fields = body.fields;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }

  /** True for the network-level synthetic codes below — never a real
   * server response, so retry/offline handling should treat these
   * differently from a genuine server-issued rejection. */
  get isNetworkFailure(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "PARSE_ERROR";
  }
}

/** Fetch itself threw (offline, DNS failure, CORS, connection reset) —
 * there is no HTTP response to parse an envelope out of. */
export function networkError(cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : "Network request failed";
  return new ApiError({ code: "NETWORK_ERROR", message }, 0);
}

/** Got an HTTP response, but the body wasn't the JSON envelope this API
 * always sends — a genuinely unexpected shape (a proxy's HTML error
 * page, a truncated response), not a documented error path. */
export function parseError(status: number, cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : "Failed to parse response";
  return new ApiError({ code: "PARSE_ERROR", message }, status);
}
