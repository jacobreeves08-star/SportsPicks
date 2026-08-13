import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./Spinner.js";

const meta: Meta<typeof Spinner> = {
  title: "Design System/Feedback/Spinner",
  component: Spinner,
};
export default meta;

type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

/** Toggle Storybook's "Motion" toolbar to "reduced" — the spin stops
 * entirely rather than just slowing down. */
export const Large: Story = { args: { size: 40 } };
