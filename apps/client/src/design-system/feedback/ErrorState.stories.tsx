import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorState } from "./ErrorState.js";

const meta: Meta<typeof ErrorState> = {
  title: "Design System/Feedback/ErrorState",
  component: ErrorState,
};
export default meta;

type Story = StoryObj<typeof ErrorState>;

export const NoRetry: Story = {
  args: { message: "Couldn't load the slate." },
};

export const WithRetry: Story = {
  args: {
    message: "Couldn't load the slate. Check your connection and try again.",
    onRetry: () => window.alert("Retry requested"),
  },
};

export const CustomRetryLabel: Story = {
  args: {
    message: "Your pick couldn't be submitted.",
    onRetry: () => window.alert("Retry requested"),
    retryLabel: "Retry pick",
  },
};
