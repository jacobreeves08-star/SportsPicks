import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { consumeVerificationToken, issueVerificationToken } from "./verification-tokens.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("verification tokens", () => {
  it("a freshly issued token consumes successfully for its purpose", async () => {
    const testUser = await createTestUser();
    const token = await issueVerificationToken(testUser.id, "email_verify");
    await expect(consumeVerificationToken(token, "email_verify")).resolves.toBe(testUser.id);
  });

  it("is single-use — consuming twice fails the second time", async () => {
    const testUser = await createTestUser();
    const token = await issueVerificationToken(testUser.id, "password_reset");
    await consumeVerificationToken(token, "password_reset");
    await expect(consumeVerificationToken(token, "password_reset")).resolves.toBeNull();
  });

  it("rejects a token consumed under the wrong purpose", async () => {
    const testUser = await createTestUser();
    const token = await issueVerificationToken(testUser.id, "email_verify");
    await expect(consumeVerificationToken(token, "password_reset")).resolves.toBeNull();
  });

  it("rejects an unknown token", async () => {
    await expect(consumeVerificationToken("bogus-token", "email_verify")).resolves.toBeNull();
  });

  it("issuing a new token of the same purpose invalidates the previous unconsumed one", async () => {
    const testUser = await createTestUser();
    const first = await issueVerificationToken(testUser.id, "email_verify");
    const second = await issueVerificationToken(testUser.id, "email_verify");

    await expect(consumeVerificationToken(first, "email_verify")).resolves.toBeNull();
    await expect(consumeVerificationToken(second, "email_verify")).resolves.toBe(testUser.id);
  });

  it("tokens of different purposes for the same user don't interfere with each other", async () => {
    const testUser = await createTestUser();
    const verifyToken = await issueVerificationToken(testUser.id, "email_verify");
    const resetToken = await issueVerificationToken(testUser.id, "password_reset");

    await expect(consumeVerificationToken(verifyToken, "email_verify")).resolves.toBe(testUser.id);
    await expect(consumeVerificationToken(resetToken, "password_reset")).resolves.toBe(testUser.id);
  });
});
