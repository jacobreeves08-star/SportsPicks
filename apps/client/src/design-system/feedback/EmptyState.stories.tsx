import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState.js";

const meta: Meta<typeof EmptyState> = {
  title: "Design System/Feedback/EmptyState",
  component: EmptyState,
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const TitleOnly: Story = {
  args: { title: "No leagues yet" },
};

export const WithDescription: Story = {
  args: {
    title: "No leagues yet",
    description: "Join one with an invite link from a friend, or start your own.",
  },
};

export const WithAction: Story = {
  args: {
    title: "No leagues yet",
    description: "Join one with an invite link from a friend, or start your own.",
    action: (
      <button type="button" onClick={() => window.alert("Navigate to join flow")}>
        Join a league
      </button>
    ),
  },
};
