import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../primitives/Stack.js";
import { ResultBadge } from "./ResultBadge.js";

const meta: Meta<typeof ResultBadge> = {
  title: "Design System/Indicators/ResultBadge",
  component: ResultBadge,
};
export default meta;

type Story = StoryObj<typeof ResultBadge>;

export const Hit: Story = { args: { outcome: "hit" } };
export const Miss: Story = { args: { outcome: "miss" } };

/** The greyscale check the a11y doc requires — apply this story's
 * `filter: grayscale(1)` via Storybook's own toolbar (or just look:
 * "Correct"/"Incorrect" and the check/x shapes are still unambiguous
 * with zero color information left). */
export const SideBySide: Story = {
  render: () => (
    <Stack gap={2}>
      <ResultBadge outcome="hit" />
      <ResultBadge outcome="miss" />
    </Stack>
  ),
};
