import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack.js";
import { NumericText } from "./NumericText.js";

const meta: Meta<typeof NumericText> = {
  title: "Design System/Primitives/NumericText",
  component: NumericText,
};
export default meta;

type Story = StoryObj<typeof NumericText>;

/** The whole point: a column of records with mixed digit widths still
 * lines up, because every digit is the same width (tabular-nums). */
export const StandingsColumnAlignment: Story = {
  render: () => (
    <Stack gap={1} align="end">
      <NumericText size="lg" weight="bold">
        11-1
      </NumericText>
      <NumericText size="lg" weight="bold">
        8-4
      </NumericText>
      <NumericText size="lg" weight="bold">
        10-2
      </NumericText>
    </Stack>
  ),
};

export const Score: Story = {
  args: { size: "xl", weight: "bold", children: "24-17" },
};
