import { describe, expect, it } from "vitest";
import { generateInviteCode, isUniqueConstraintViolation, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code.js";

describe("generateInviteCode", () => {
  it("produces a code of the expected length", () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("only uses characters from the safe alphabet", () => {
    const code = generateInviteCode();
    for (const char of code) {
      expect(INVITE_CODE_ALPHABET).toContain(char);
    }
  });

  it("never contains the excluded ambiguous characters", () => {
    // Belt and suspenders on top of the alphabet-membership check above
    // — this is the literal requirement, spelled out explicitly.
    const code = generateInviteCode();
    for (const excluded of ["0", "O", "1", "I", "L"]) {
      expect(code).not.toContain(excluded);
    }
  });

  it("produces different codes across calls (astronomically unlikely to collide)", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("isUniqueConstraintViolation", () => {
  it("recognizes a Drizzle-wrapped Postgres 23505 error via .cause", () => {
    const pgError = Object.assign(new Error("duplicate key value"), { code: "23505" });
    const wrapped = Object.assign(new Error("Failed query: insert into..."), { cause: pgError });
    expect(isUniqueConstraintViolation(wrapped)).toBe(true);
  });

  it("returns false for an unrelated error", () => {
    expect(isUniqueConstraintViolation(new Error("something else"))).toBe(false);
  });

  it("returns false for a non-Error thrown value", () => {
    expect(isUniqueConstraintViolation("boom")).toBe(false);
  });
});
