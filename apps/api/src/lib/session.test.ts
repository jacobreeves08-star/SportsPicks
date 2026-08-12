import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { authenticateAccessToken, createSession, revokeAllSessionsForUser, revokeSession, rotateSession } from "./session.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("session lifecycle", () => {
  it("a freshly created session's access token authenticates", async () => {
    const testUser = await createTestUser();
    const { accessToken } = await createSession(testUser.id);
    const authed = await authenticateAccessToken(accessToken);
    expect(authed).toEqual({ userId: testUser.id, sessionId: expect.any(String) });
  });

  it("rejects a garbage access token", async () => {
    await expect(authenticateAccessToken("not-a-real-token")).resolves.toBeNull();
  });

  it("rotating a refresh token issues a new pair and invalidates the old refresh token", async () => {
    const testUser = await createTestUser();
    const first = await createSession(testUser.id);

    const rotated = await rotateSession(first.refreshToken);
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshToken).not.toBe(first.refreshToken);
    expect(rotated!.accessToken).not.toBe(first.accessToken);

    // Reusing the old, now-rotated-away refresh token fails.
    await expect(rotateSession(first.refreshToken)).resolves.toBeNull();

    // The new access token from rotation works.
    const authed = await authenticateAccessToken(rotated!.accessToken);
    expect(authed?.userId).toBe(testUser.id);

    // The OLD access token issued before rotation no longer works either
    // — rotation overwrites the row's access_token_hash too.
    await expect(authenticateAccessToken(first.accessToken)).resolves.toBeNull();
  });

  it("rejects rotating an unknown refresh token", async () => {
    await expect(rotateSession("bogus-refresh-token")).resolves.toBeNull();
  });

  it("revokeSession invalidates that session's access token", async () => {
    const testUser = await createTestUser();
    const { accessToken } = await createSession(testUser.id);
    const authed = await authenticateAccessToken(accessToken);
    await revokeSession(authed!.sessionId);
    await expect(authenticateAccessToken(accessToken)).resolves.toBeNull();
  });

  it("revoked session's refresh token can no longer be rotated", async () => {
    const testUser = await createTestUser();
    const issued = await createSession(testUser.id);
    const authed = await authenticateAccessToken(issued.accessToken);
    await revokeSession(authed!.sessionId);
    await expect(rotateSession(issued.refreshToken)).resolves.toBeNull();
  });

  it("revokeAllSessionsForUser logs out every device", async () => {
    const testUser = await createTestUser();
    const a = await createSession(testUser.id);
    const b = await createSession(testUser.id);

    await revokeAllSessionsForUser(testUser.id);

    await expect(authenticateAccessToken(a.accessToken)).resolves.toBeNull();
    await expect(authenticateAccessToken(b.accessToken)).resolves.toBeNull();
  });

  it("revokeAllSessionsForUser can keep one session alive via exceptSessionId", async () => {
    const testUser = await createTestUser();
    const keep = await createSession(testUser.id);
    const kill = await createSession(testUser.id);
    const keepAuthed = await authenticateAccessToken(keep.accessToken);

    await revokeAllSessionsForUser(testUser.id, keepAuthed!.sessionId);

    await expect(authenticateAccessToken(keep.accessToken)).resolves.not.toBeNull();
    await expect(authenticateAccessToken(kill.accessToken)).resolves.toBeNull();
  });

  it("does not authenticate one user's session as a different user", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const sessionA = await createSession(userA.id);
    const authed = await authenticateAccessToken(sessionA.accessToken);
    expect(authed?.userId).toBe(userA.id);
    expect(authed?.userId).not.toBe(userB.id);
  });
});
