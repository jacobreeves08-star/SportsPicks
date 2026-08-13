import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingState } from "./LoadingState.js";

const meta: Meta<typeof LoadingState> = {
  title: "Design System/Feedback/LoadingState",
  component: LoadingState,
};
export default meta;

type Story = StoryObj<typeof LoadingState>;

export const Default: Story = {};
export const TwoRows: Story = { args: { rows: 2 } };
export const SixRows: Story = { args: { rows: 6 } };
