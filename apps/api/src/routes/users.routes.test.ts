import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { truncateAllTables } from "../db/test-helpers.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

async function signupAndLogin(email: string, password = "correcthorsebattery") {
  await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password, displayName: "Test", timezone: "UTC" },
  });
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  return res.json() as { accessToken: string; refreshToken: string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("GET /users/me", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/users/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({ method: "GET", url: "/users/me", headers: auth("not-a-real-token") });
    expect(res.statusCode).toBe(401);
  });

  it("succeeds with a valid token and never includes password_hash", async () => {
    const { accessToken } = await signupAndLogin("me1@example.com");
    const res = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("me1@example.com");
    expect(body).not.toHaveProperty("passwordHash");
    expect(body).not.toHaveProperty("password_hash");
  });
});

describe("PATCH /users/me", () => {
  it("updates displayName", async () => {
    const { accessToken } = await signupAndLogin("patch1@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { displayName: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("New Name");
  });

  it("changing timezone includes a lock-time warning", async () => {
    const { accessToken } = await signupAndLogin("patch2@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { timezone: "America/Chicago" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toMatch(/lock/i);
  });

  it("rejects an invalid timezone with the validation envelope", async () => {
    const { accessToken } = await signupAndLogin("patch3@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { timezone: "Nowhere/Fake" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields[0].field).toBe("timezone");
  });
});

describe("POST /users/me/change-password", () => {
  it("rejects the wrong current password", async () => {
    const { accessToken } = await signupAndLogin("changepw1@example.com", "originalpassword");
    const res = await app.inject({
      method: "POST",
      url: "/users/me/change-password",
      headers: auth(accessToken),
      payload: { currentPassword: "wrongpassword", newPassword: "newpassword123" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("CURRENT_PASSWORD_INCORRECT");
  });

  it("with the correct current password: revokes OTHER sessions but not the one used for the change", async () => {
    const { accessToken: sessionA } = await signupAndLogin("changepw2@example.com", "originalpassword");
    const loginB = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "changepw2@example.com", password: "originalpassword" },
    });
    const sessionB = loginB.json().accessToken as string;

    const changeRes = await app.inject({
      method: "POST",
      url: "/users/me/change-password",
      headers: auth(sessionA),
      payload: { currentPassword: "originalpassword", newPassword: "newpassword123" },
    });
    expect(changeRes.statusCode).toBe(200);

    const checkA = await app.inject({ method: "GET", url: "/users/me", headers: auth(sessionA) });
    const checkB = await app.inject({ method: "GET", url: "/users/me", headers: auth(sessionB) });
    expect(checkA.statusCode).toBe(200);
    expect(checkB.statusCode).toBe(401);
  });
});

describe("POST /users/me/deletion-request", () => {
  it("revokes every session, including the one used for the request itself", async () => {
    const { accessToken } = await signupAndLogin("delete1@example.com");

    const res = await app.inject({ method: "POST", url: "/users/me/deletion-request", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("scheduledDeletionAt");

    const after = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(after.statusCode).toBe(401);
  });

  it("deletion-cancel clears the scheduled deletion (verified via a fresh login)", async () => {
    const { accessToken } = await signupAndLogin("delete2@example.com", "somepassword");
    await app.inject({ method: "POST", url: "/users/me/deletion-request", headers: auth(accessToken) });

    const relogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "delete2@example.com", password: "somepassword" },
    });
    expect(relogin.statusCode).toBe(200);
    const newAccessToken = relogin.json().accessToken as string;

    const cancelRes = await app.inject({
      method: "POST",
      url: "/users/me/deletion-cancel",
      headers: auth(newAccessToken),
    });
    expect(cancelRes.statusCode).toBe(200);

    const profile = await app.inject({ method: "GET", url: "/users/me", headers: auth(newAccessToken) });
    expect(profile.json().scheduledDeletionAt).toBeNull();
  });
});

describe("GET /users/me/export", () => {
  it("returns the profile without password_hash", async () => {
    const { accessToken } = await signupAndLogin("export1@example.com");
    const res = await app.inject({ method: "GET", url: "/users/me/export", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.email).toBe("export1@example.com");
    expect(body.profile).not.toHaveProperty("passwordHash");
    expect(body).toHaveProperty("memberships");
    expect(body).toHaveProperty("picks");
  });
});
