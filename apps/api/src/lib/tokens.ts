import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque bearer tokens (session access/refresh, email verification/reset
 * links) — generated with enough entropy that a plain sha256 digest is a
 * safe way to store them at rest (unlike passwords, there's no need for
 * a slow adaptive hash or a pepper: the input is already uniformly
 * random, not a low-entropy human-chosen secret).
 */
export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
