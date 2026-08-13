import type { Meta, StoryObj } from "@storybook/react-vite";
import { LockBadge } from "./LockBadge.js";

const meta: Meta<typeof LockBadge> = {
  title: "Design System/Indicators/LockBadge",
  component: LockBadge,
};
export default meta;

type Story = StoryObj<typeof LockBadge>;

export const Default: Story = {};
