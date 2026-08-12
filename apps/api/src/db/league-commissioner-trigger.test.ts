import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./client.js";
import { league, leagueMember } from "./schema.js";
import { createTestLeague, createTestLeagueMember, createTestUser, truncateAllTables } from "./test-helpers.js";

/**
 * Isolates the commissioner invariant (0004_leagues_membership.sql:
 * sync_commissioner_role trigger + the league_member_one_commissioner_
 * per_league deferrable EXCLUDE backstop) at the database level, direct
 * SQL against the trigger — not through the routes. See
 * docs/leagues-and-membership.md for the full design rationale.
 */

beforeEach(async () => {
  await truncateAllTables();
});

async function roleOf(userId: string, leagueId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(leagueMember)
    .where(and(eq(leagueMember.userId, userId), eq(leagueMember.leagueId, leagueId)));
  return row?.role;
}

// Drizzle wraps the real Postgres error in a generic "Failed query: ..."
// message; the actual raised-exception text is on `.cause` — same fix as
// game-pick-trigger.test.ts's insertRejectionMessage().
async function updateRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = err instanceof Error ? (err.cause ?? err) : err;
    return String(cause instanceof Error ? cause.message : cause);
  }
  throw new Error("expected the update to be rejected, but it succeeded");
}

describe("sync_commissioner_role trigger", () => {
  it("transferring to a valid active member flips both rows' role in one UPDATE", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(other.id, testLeague.id, { role: "member" });

    await db.update(league).set({ commissionerId: other.id }).where(eq(league.id, testLeague.id));

    expect(await roleOf(owner.id, testLeague.id)).toBe("member");
    expect(await roleOf(other.id, testLeague.id)).toBe("commissioner");
  });

  it("rejects a transfer to someone who isn't an active member of the league (row_count guard)", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    // Deliberately NOT added as a member of testLeague.

    const message = await updateRejectionMessage(
      db.update(league).set({ commissionerId: stranger.id }).where(eq(league.id, testLeague.id)),
    );
    expect(message).toMatch(/does not match exactly one active member/);

    // The failed UPDATE must have rolled back — commissioner_id and the
    // original commissioner's role are both unchanged.
    const [row] = await db.select().from(league).where(eq(league.id, testLeague.id));
    expect(row!.commissionerId).toBe(owner.id);
    expect(await roleOf(owner.id, testLeague.id)).toBe("commissioner");
  });

  it("rejects a transfer to a member who has left the league (leftAt is not null)", async () => {
    const owner = await createTestUser();
    const departed = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(departed.id, testLeague.id, { role: "member", leftAt: new Date() });

    const message = await updateRejectionMessage(
      db.update(league).set({ commissionerId: departed.id }).where(eq(league.id, testLeague.id)),
    );
    expect(message).toMatch(/does not match exactly one active member/);
  });

  it("multiple transfers in sequence keep exactly one commissioner each time", async () => {
    const owner = await createTestUser();
    const memberB = await createTestUser();
    const memberC = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(memberB.id, testLeague.id, { role: "member" });
    await createTestLeagueMember(memberC.id, testLeague.id, { role: "member" });

    await db.update(league).set({ commissionerId: memberB.id }).where(eq(league.id, testLeague.id));
    await db.update(league).set({ commissionerId: memberC.id }).where(eq(league.id, testLeague.id));

    const commissioners = await db
      .select()
      .from(leagueMember)
      .where(
        and(eq(leagueMember.leagueId, testLeague.id), eq(leagueMember.role, "commissioner"), isNull(leagueMember.leftAt)),
      );
    expect(commissioners).toHaveLength(1);
    expect(commissioners[0]!.userId).toBe(memberC.id);
  });
});
