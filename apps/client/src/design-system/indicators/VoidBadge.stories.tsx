import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../primitives/Stack.js";
import { VoidBadge } from "./VoidBadge.js";

const meta: Meta<typeof VoidBadge> = {
  title: "Design System/Indicators/VoidBadge",
  component: VoidBadge,
};
export default meta;

type Story = StoryObj<typeof VoidBadge>;

export const Postponed: Story = { args: { reason: "postponed" } };
export const Canceled: Story = { args: { reason: "canceled" } };

export const SideBySide: Story = {
  render: () => (
    <Stack gap={2}>
      <VoidBadge reason="postponed" />
      <VoidBadge reason="canceled" />
    </Stack>
  ),
};
