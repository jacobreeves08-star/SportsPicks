import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { requireLeagueCommissioner, requireLeagueMembership, requireOwnMembership } from "./authorization.js";
import { ApiError } from "./http-errors.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("requireLeagueMembership", () => {
  it("passes for an actual member and returns their membership row", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const result = await requireLeagueMembership(owner.id, league.id);
    expect(result.id).toBe(member.id);
  });

  it("throws 403 FORBIDDEN for a user who belongs to a DIFFERENT league (cross-league)", async () => {
    const owner = await createTestUser();
    const leagueA = await createTestLeague(owner.id);
    const leagueB = await createTestLeague(owner.id);
    const outsider = await createTestUser();
    await createTestLeagueMember(outsider.id, leagueB.id);

    await expect(requireLeagueMembership(outsider.id, leagueA.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<ApiError>);
  });

  it("throws 403 FORBIDDEN for a user with no membership anywhere", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const outsider = await createTestUser();

    await expect(requireLeagueMembership(outsider.id, league.id)).rejects.toBeInstanceOf(ApiError);
  });

  it("throws 403 FORBIDDEN for a member who has left (leftAt is set) — a stale session must not still pass", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const departed = await createTestUser();
    await createTestLeagueMember(departed.id, league.id, { leftAt: new Date() });

    await expect(requireLeagueMembership(departed.id, league.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<ApiError>);
  });
});

describe("requireLeagueCommissioner", () => {
  it("passes for the commissioner", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    await expect(requireLeagueCommissioner(owner.id, league.id)).resolves.toBeDefined();
  });

  it("throws 403 FORBIDDEN for a non-commissioner member", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const regular = await createTestUser();
    await createTestLeagueMember(regular.id, league.id, { role: "member" });

    await expect(requireLeagueCommissioner(regular.id, league.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<ApiError>);
  });

  it("throws for a non-member entirely (membership check runs first)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const outsider = await createTestUser();

    await expect(requireLeagueCommissioner(outsider.id, league.id)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("requireOwnMembership", () => {
  it("passes when memberId is the caller's own membership row", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);

    const result = await requireOwnMembership(owner.id, league.id, member.id);
    expect(result.id).toBe(member.id);
  });

  it("throws 403 FORBIDDEN when userA attempts to act as userB's membership (cross-user ownership)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id);
    const memberB = await createTestLeagueMember(userB.id, league.id);

    await expect(requireOwnMembership(userA.id, league.id, memberB.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    } satisfies Partial<ApiError>);
  });

  it("still throws (via the membership check) for a non-member attempting any memberId", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const outsider = await createTestUser();

    await expect(requireOwnMembership(outsider.id, league.id, member.id)).rejects.toBeInstanceOf(ApiError);
  });
});

// Sanity check that the fixtures used above (games) work too, since
// leagues.routes.test.ts (JAC-17's HTTP-level tests) will build on the
// same helpers with games/picks in the mix.
describe("fixtures smoke test", () => {
  it("createTestGame produces a usable row", async () => {
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    expect(g.homeTeam).toBe("Bills");
  });
});
