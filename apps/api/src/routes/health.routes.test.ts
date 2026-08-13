import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  createTestGame,
  createTestJobRun,
  createTestLeague,
  createTestLeagueMember,
  createTestPickAuditLog,
  createTestResultCorrection,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("GET /health/data-freshness", () => {
  it("requires no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.statusCode).toBe(200);
  });

  it("returns null job status when neither job has ever run", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const body = res.json();
    expect(body.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobName: "schedule-ingest", lastRunAt: null, lastSuccessAt: null }),
        expect.objectContaining({ jobName: "score-poll", lastRunAt: null, lastSuccessAt: null }),
      ]),
    );
    expect(body.staleGameCount).toBe(0);
  });

  it("reflects a successful run", async () => {
    await createTestJobRun({ jobName: "score-poll", succeeded: true, itemCount: 2 });
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const scorePoll = res.json().jobs.find((j: { jobName: string }) => j.jobName === "score-poll");
    expect(scorePoll.lastRunSucceeded).toBe(true);
    expect(scorePoll.lastSuccessAt).not.toBeNull();
  });

  it("reflects a failed run distinctly from lastSuccessAt", async () => {
    await createTestJobRun({ jobName: "schedule-ingest", succeeded: false, errorMessage: "boom" });
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const scheduleIngest = res.json().jobs.find((j: { jobName: string }) => j.jobName === "schedule-ingest");
    expect(scheduleIngest.lastRunSucceeded).toBe(false);
    expect(scheduleIngest.lastSuccessAt).toBeNull();
  });

  it("staleGameCount reflects findStaleGames", async () => {
    await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(10) }); // stale
    await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(1) }); // not stale

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().staleGameCount).toBe(1);
  });

  it("returns ISO-8601 UTC timestamps, per api-conventions", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("tracks all six jobs, including the ones added this epic (JAC-43-48)", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const jobNames = res.json().jobs.map((j: { jobName: string }) => j.jobName);
    expect(jobNames).toEqual(
      expect.arrayContaining([
        "schedule-ingest",
        "score-poll",
        "anonymize-accounts",
        "pick-reminder",
        "results-summary",
        "operator-digest",
      ]),
    );
  });

  it("counts signups in the last 24h (JAC-43-48)", async () => {
    await createTestUser();
    await createTestUser();

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().signupsLast24h).toBe(2);
  });

  it("counts result corrections in the last 24h (JAC-43-48)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const game = await createTestGame({ sport: "nfl" });
    await createTestResultCorrection(game.id, { correctedFromLeagueId: league.id });

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().correctionsLast24h).toBe(1);
  });

  it("counts picks (from pick_audit_log) in the last 24h (JAC-43-48)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({ sport: "nfl" });
    await createTestPickAuditLog(member.id, game.id);
    await createTestPickAuditLog(member.id, game.id, { action: "change" });

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().picksLast24h).toBe(2);
  });

  it("includes a slate-completion entry per league (JAC-43-48)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { name: "Ops Summary League" });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const entry = res
      .json()
      .slateCompletionRates.find((s: { leagueId: string }) => s.leagueId === league.id);
    expect(entry).toMatchObject({ leagueName: "Ops Summary League", totalMembers: 0, completedCount: 0, rate: null });
  });
});
