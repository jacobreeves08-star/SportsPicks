import type { Meta, StoryObj } from "@storybook/react-vite";
import { Surface } from "./Surface.js";
import { Stack } from "./Stack.js";

const meta: Meta<typeof Stack> = {
  title: "Design System/Primitives/Stack",
  component: Stack,
};
export default meta;

type Story = StoryObj<typeof Stack>;

function Box({ label }: { label: string }) {
  return (
    <Surface variant="raised" padding={3} radius="sm">
      {label}
    </Surface>
  );
}

export const Column: Story = {
  render: () => (
    <Stack gap={3}>
      <Box label="one" />
      <Box label="two" />
      <Box label="three" />
    </Stack>
  ),
};

export const RowWrapped: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap>
      <Box label="one" />
      <Box label="two" />
      <Box label="three" />
    </Stack>
  ),
};

export const RowSpaceBetween: Story = {
  render: () => (
    <Stack direction="row" justify="between" align="center">
      <Box label="left" />
      <Box label="right" />
    </Stack>
  ),
};
