import { describe, expect, it } from "vitest";
import { describePickControl, describeSide } from "./describe-pick-control.js";
import type { PickControlTeams } from "./PickControl.types.js";

const teams: PickControlTeams = {
  homeTeam: "Bills",
  awayTeam: "Jets",
  allowsDraw: false,
  startsAt: "2026-08-13T18:00:00.000Z",
};

describe("describePickControl", () => {
  it("open + unpicked (pickState: unpicked)", () => {
    const text = describePickControl({ status: "open", selected: null }, teams);
    expect(text).toMatch(/^Bills vs Jets\. No pick yet\. Locks /);
  });

  it("open + picked (pickState: picked_open)", () => {
    const text = describePickControl({ status: "open", selected: "Bills" }, teams);
    expect(text).toMatch(/^Bills vs Jets\. You picked Bills\. Still open — locks /);
  });

  it("locked with a pick (pickState: locked, myPick set)", () => {
    const text = describePickControl({ status: "locked", selected: "Jets" }, teams);
    expect(text).toBe("Bills vs Jets. Locked. You picked Jets.");
  });

  it("locked with no pick — never silent about a missed pick", () => {
    const text = describePickControl({ status: "locked", selected: null }, teams);
    expect(text).toBe("Bills vs Jets. Locked. You did not make a pick.");
  });

  it("final hit (pickState: final_hit)", () => {
    const text = describePickControl(
      { status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" },
      teams,
    );
    expect(text).toBe("Bills vs Jets. Final: Bills won. You picked Bills — correct.");
  });

  it("final miss with a wrong pick (pickState: final_miss)", () => {
    const text = describePickControl(
      { status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" },
      teams,
    );
    expect(text).toBe("Bills vs Jets. Final: Bills won. You picked Jets — incorrect.");
  });

  it("final miss with no pick at all — pickState's final_miss covers both cases", () => {
    const text = describePickControl(
      { status: "final", selected: null, winningTeam: "Bills", outcome: "miss" },
      teams,
    );
    expect(text).toBe("Bills vs Jets. Final: Bills won. You did not make a pick.");
  });

  it("void: postponed", () => {
    const text = describePickControl({ status: "void", reason: "postponed", selected: null }, teams);
    expect(text).toBe("Bills vs Jets. Postponed. This game does not count.");
  });

  it("void: canceled", () => {
    const text = describePickControl({ status: "void", reason: "canceled", selected: "Bills" }, teams);
    expect(text).toBe("Bills vs Jets. Canceled. This game does not count.");
  });

  it("pending", () => {
    const text = describePickControl({ status: "pending", optimistic: "Bills", previous: null }, teams);
    expect(text).toBe("Bills vs Jets. Saving Bills.");
  });

  it("rejected reverts to the prior pick and explains why", () => {
    const text = describePickControl(
      { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "This game already locked." },
      teams,
    );
    expect(text).toBe("Bills vs Jets. Jets wasn't saved: This game already locked.. Reverted to Bills.");
  });

  it("rejected with no prior pick to revert to", () => {
    const text = describePickControl(
      { status: "rejected", attempted: "Jets", revertedTo: null, message: "This game already locked." },
      teams,
    );
    expect(text).toMatch(/Reverted to no pick\.$/);
  });

  it("queued — explicitly says 'not saved yet'", () => {
    const text = describePickControl({ status: "queued", queued: "Bills", previous: null }, teams);
    expect(text).toBe("Bills vs Jets. Bills selected — not saved yet. Will send when back online.");
  });

  it("falls back to a safe placeholder for an unparseable startsAt rather than throwing", () => {
    const badTeams: PickControlTeams = { ...teams, startsAt: "not-a-date" };
    const text = describePickControl({ status: "open", selected: null }, badTeams);
    expect(text).toBe("Bills vs Jets. No pick yet. Locks soon.");
  });
});

describe("describeSide", () => {
  it("translates the literal API 'DRAW' sentinel to the human label", () => {
    expect(describeSide("DRAW")).toBe("Draw");
  });

  it("passes real team names through unchanged", () => {
    expect(describeSide("Bills")).toBe("Bills");
  });

  it("is what a draw-eligible game's announcement actually says", () => {
    const drawTeams: PickControlTeams = { homeTeam: "Arsenal", awayTeam: "Chelsea", allowsDraw: true, startsAt: teams.startsAt };
    const text = describePickControl({ status: "locked", selected: "DRAW" }, drawTeams);
    expect(text).toBe("Arsenal vs Chelsea. Locked. You picked Draw.");
  });
});
