import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

describe("CORS (client infrastructure)", () => {
  it("answers a preflight OPTIONS request for the allowed client origin — without this, a real browser blocks every cross-origin request before it reaches any route (confirmed empirically against a real dev server)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/leagues/some-id/slate",
      headers: {
        origin: env.PUBLIC_CLIENT_URL,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(env.PUBLIC_CLIENT_URL);
  });

  it("exposes X-Server-Time to browser JS on a cross-origin response — otherwise it's sent but invisible to the client's own code", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: env.PUBLIC_CLIENT_URL } });

    expect(res.headers["access-control-expose-headers"]).toContain("X-Server-Time");
  });

  it("allows PUT/PATCH/DELETE in the preflight response — @fastify/cors's own default (GET/HEAD/POST only) silently breaks pick writes, profile/league updates, and deletion from a real browser", async () => {
    const app = buildApp();
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/leagues/some-id",
        headers: {
          origin: env.PUBLIC_CLIENT_URL,
          "access-control-request-method": method,
        },
      });
      expect(res.headers["access-control-allow-methods"]).toContain(method);
    }
  });

  it("does not reflect an arbitrary, unlisted origin", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/leagues/some-id/slate",
      headers: {
        origin: "https://not-the-client.example.com",
        "access-control-request-method": "GET",
      },
    });

    expect(res.headers["access-control-allow-origin"]).not.toBe("https://not-the-client.example.com");
  });
});

describe("X-Server-Time header (client infrastructure)", () => {
  it("is present, ISO-8601 UTC, on a successful response", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    const header = res.headers["x-server-time"];
    expect(typeof header).toBe("string");
    expect(header).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("is present on an error response too — a client can resync from any request", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/no-such-route" });

    expect(res.statusCode).toBe(404);
    expect(res.headers["x-server-time"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
