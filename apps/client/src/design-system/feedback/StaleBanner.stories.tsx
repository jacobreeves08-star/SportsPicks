import type { Meta, StoryObj } from "@storybook/react-vite";
import { StaleBanner } from "./StaleBanner.js";

const meta: Meta<typeof StaleBanner> = {
  title: "Design System/Feedback/StaleBanner",
  component: StaleBanner,
};
export default meta;

type Story = StoryObj<typeof StaleBanner>;

export const WithoutReason: Story = {
  args: { asOf: "2026-08-13T15:04:00.000Z" },
};

export const WithReason: Story = {
  args: { asOf: "2026-08-13T15:04:00.000Z", reason: "sports data provider is degraded" },
};
