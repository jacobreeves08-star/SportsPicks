import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack.js";
import { Surface } from "./Surface.js";
import { Text } from "./Text.js";

const meta: Meta<typeof Surface> = {
  title: "Design System/Primitives/Surface",
  component: Surface,
};
export default meta;

type Story = StoryObj<typeof Surface>;

export const PageBackground: Story = {
  args: { variant: "surface", padding: 4, children: <Text>page surface</Text> },
};

export const RaisedCard: Story = {
  args: { variant: "raised", padding: 4, radius: "lg", elevation: 1, children: <Text>raised card</Text> },
};

export const ElevationLevels: Story = {
  render: () => (
    <Stack direction="row" gap={4}>
      {([0, 1, 2] as const).map((elevation) => (
        <Surface key={elevation} variant="raised" padding={4} elevation={elevation}>
          <Text>elevation {elevation}</Text>
        </Surface>
      ))}
    </Stack>
  ),
};
