import { randomInt } from "node:crypto";

// Excludes 0/O and 1/I/L — these get read aloud in group chats and typed
// on phones, so visually/verbally ambiguous characters are dropped
// entirely rather than relying on the reader to guess which one was
// meant. 26 letters - {I, L, O} + 10 digits - {0, 1} = 31 characters.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

/**
 * ~31^8 (≈8.5×10^11) possible codes — combined with rate-limited
 * redemption (see league-invites.routes.ts), not brute-forceable. Each
 * character is drawn via crypto.randomInt, which is unbiased (unlike
 * `Math.random() % alphabet.length`).
 */
export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * True if `err` (as thrown by Drizzle, which wraps the real driver error
 * on `.cause`) is a Postgres unique-violation (SQLSTATE 23505) — used to
 * retry invite-code generation on the astronomically rare collision
 * rather than failing the whole request.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause ?? err) : err;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}
