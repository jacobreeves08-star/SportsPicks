import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("round-trips: a hash verifies against its own plaintext", async () => {
    const hashed = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hashed, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hashed = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hashed, "wrong password")).resolves.toBe(false);
  });

  it("produces a different hash each time for the same input (salted)", async () => {
    const [a, b] = await Promise.all([hashPassword("same input"), hashPassword("same input")]);
    expect(a).not.toBe(b);
  });

  it("produces an argon2id-tagged hash", async () => {
    const hashed = await hashPassword("whatever");
    expect(hashed.startsWith("$argon2id$")).toBe(true);
  });
});
