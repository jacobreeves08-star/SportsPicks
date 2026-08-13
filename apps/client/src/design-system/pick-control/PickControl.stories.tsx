import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { PickControl } from "./PickControl.js";
import type { PickControlState, PickControlTeams } from "./PickControl.types.js";

const meta: Meta<typeof PickControl> = {
  title: "Design System/PickControl",
  component: PickControl,
  parameters: {
    docs: {
      description: {
        component:
          "The signature component (Epic 9 brief). A radio group, not two buttons — arrow keys move focus and select, disabled sides stay focusable. Renders all 4 GameState kinds plus the mutation pattern's pending/rejected, plus a queued (offline) state.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof PickControl>;

const teams: PickControlTeams = {
  homeTeam: "Bills",
  awayTeam: "Jets",
  allowsDraw: false,
  startsAt: "2026-08-13T18:00:00.000Z",
};

const drawTeams: PickControlTeams = { ...teams, homeTeam: "Arsenal", awayTeam: "Chelsea", allowsDraw: true };

export const Unpicked: Story = {
  args: { teams, state: { status: "open", selected: null }, remainingMs: 90 * 60_000 },
};

export const PickedOpen: Story = {
  args: { teams, state: { status: "open", selected: "Bills" }, remainingMs: 5 * 60_000 },
};

export const Locked: Story = {
  args: { teams, state: { status: "locked", selected: "Bills" } },
};

export const LockedNoPick: Story = {
  name: "Locked (never picked)",
  args: { teams, state: { status: "locked", selected: null } },
};

export const FinalHit: Story = {
  args: { teams, state: { status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" } },
};

export const FinalMiss: Story = {
  args: { teams, state: { status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" } },
};

export const FinalNeverPicked: Story = {
  args: { teams, state: { status: "final", selected: null, winningTeam: "Bills", outcome: "miss" } },
};

export const VoidPostponed: Story = {
  args: { teams, state: { status: "void", reason: "postponed", selected: "Bills" } },
};

export const VoidCanceled: Story = {
  args: { teams, state: { status: "void", reason: "canceled", selected: null } },
};

export const Pending: Story = {
  args: { teams, state: { status: "pending", optimistic: "Bills", previous: null } },
};

export const Rejected: Story = {
  args: {
    teams,
    state: { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "This game already locked." },
  },
};

export const RejectedNoPriorPick: Story = {
  args: {
    teams,
    state: { status: "rejected", attempted: "Bills", revertedTo: null, message: "This game already locked." },
  },
};

export const Queued: Story = {
  name: "Queued (offline, unsaved)",
  args: { teams, state: { status: "queued", queued: "Bills", previous: null } },
};

export const DrawEligibleOpen: Story = {
  name: "Draw-eligible — open",
  args: { teams: drawTeams, state: { status: "open", selected: null }, remainingMs: 20 * 60_000 },
};

export const DrawEligibleFinalDraw: Story = {
  name: "Draw-eligible — final, picked Draw and was right",
  args: { teams: drawTeams, state: { status: "final", selected: "DRAW", winningTeam: "DRAW", outcome: "hit" } },
};

/** Every state, one after another — the fastest way to eyeball the
 * whole state machine (and, per the a11y doc, to check it in
 * greyscale via Storybook's own color-vision toolbar). */
export const AllStates: Story = {
  render: () => {
    const states: Array<{ label: string; state: PickControlState }> = [
      { label: "Unpicked", state: { status: "open", selected: null } },
      { label: "Picked, open", state: { status: "open", selected: "Bills" } },
      { label: "Locked", state: { status: "locked", selected: "Bills" } },
      { label: "Locked, never picked", state: { status: "locked", selected: null } },
      { label: "Final — hit", state: { status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" } },
      { label: "Final — miss", state: { status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" } },
      { label: "Postponed", state: { status: "void", reason: "postponed", selected: null } },
      { label: "Canceled", state: { status: "void", reason: "canceled", selected: "Bills" } },
      { label: "Pending (saving)", state: { status: "pending", optimistic: "Bills", previous: null } },
      {
        label: "Rejected",
        state: { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "This game already locked." },
      },
      { label: "Queued (offline)", state: { status: "queued", queued: "Bills", previous: null } },
    ];
    return (
      <Stack gap={4}>
        {states.map(({ label, state }) => (
          <Stack key={label} gap={1}>
            <Text size="xs" color="dim" weight="medium">
              {label}
            </Text>
            <PickControl teams={teams} state={state} remainingMs={state.status === "open" ? 90 * 60_000 : undefined} />
          </Stack>
        ))}
      </Stack>
    );
  },
};
