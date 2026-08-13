import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

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
