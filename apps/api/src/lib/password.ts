import { hash, verify, Algorithm } from "@node-rs/argon2";

/**
 * Argon2id via @node-rs/argon2 (prebuilt native binaries — deliberately
 * not the `argon2` package, which needs node-gyp/a C toolchain to
 * install). Params are OWASP's second recommended Argon2id configuration
 * (19 MiB memory, 2 iterations, 1 thread) — a reasonable balance for a
 * small Render instance rather than the library's lighter defaults.
 * See docs/adr/0002-auth-session-hashing-email.md.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain);
}
