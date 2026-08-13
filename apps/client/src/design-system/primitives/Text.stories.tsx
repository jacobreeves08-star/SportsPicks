import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack.js";
import { Text, type TextColor, type TextSize } from "./Text.js";

const meta: Meta<typeof Text> = {
  title: "Design System/Primitives/Text",
  component: Text,
  args: { children: "The quick brown fox" },
};
export default meta;

type Story = StoryObj<typeof Text>;

export const Default: Story = {};

const SIZES: TextSize[] = ["xs", "sm", "md", "lg", "xl"];
export const Sizes: Story = {
  render: () => (
    <Stack gap={2}>
      {SIZES.map((size) => (
        <Text key={size} size={size}>
          {size} — The quick brown fox
        </Text>
      ))}
    </Stack>
  ),
};

const COLORS: TextColor[] = ["default", "dim", "pick-mine", "hit", "miss", "locked", "open", "stale", "error"];
export const Colors: Story = {
  render: () => (
    <Stack gap={2}>
      {COLORS.map((color) => (
        <Text key={color} color={color} weight="medium">
          {color}
        </Text>
      ))}
    </Stack>
  ),
};
