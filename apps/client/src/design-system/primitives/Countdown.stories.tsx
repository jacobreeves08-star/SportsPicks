import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack.js";
import { Countdown } from "./Countdown.js";

const meta: Meta<typeof Countdown> = {
  title: "Design System/Primitives/Countdown",
  component: Countdown,
};
export default meta;

type Story = StoryObj<typeof Countdown>;

export const ThirtySecondsOut: Story = {
  args: { remainingMs: 30_000, weight: "bold" },
};

export const FiveMinutesOut: Story = {
  args: { remainingMs: 5 * 60_000, weight: "bold" },
};

export const OverAnHourOut: Story = {
  args: { remainingMs: 90 * 60_000, weight: "bold" },
};

export const AtLock: Story = {
  args: { remainingMs: 0, weight: "bold", color: "locked" },
};

/** Every stage of a countdown counting down toward kickoff. */
export const AllStages: Story = {
  render: () => (
    <Stack gap={2}>
      <Countdown remainingMs={90 * 60_000} weight="bold" />
      <Countdown remainingMs={5 * 60_000} weight="bold" />
      <Countdown remainingMs={30_000} weight="bold" color="locked" />
      <Countdown remainingMs={0} weight="bold" color="locked" />
    </Stack>
  ),
};
