import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertIcon, CloudOffIcon, Stack } from "../../design-system/index.js";
import { StatusBanner } from "./StatusBanner.js";

const meta: Meta<typeof StatusBanner> = {
  title: "App Shell/Banners/StatusBanner",
  component: StatusBanner,
};
export default meta;

type Story = StoryObj<typeof StatusBanner>;

export const Offline: Story = {
  args: { icon: <CloudOffIcon />, message: "You're offline. Picks will send once you're back.", tone: "warning" },
};

export const Degraded: Story = {
  args: { icon: <AlertIcon />, message: "Having trouble reaching the server.", tone: "warning" },
};

export const Reconnecting: Story = {
  args: { icon: <CloudOffIcon />, message: "Back online — sending your queued picks…", tone: "info" },
};

export const UnsavedPicks: Story = {
  args: { icon: <CloudOffIcon />, message: "2 picks haven't saved yet.", tone: "info" },
};

export const AllTones: Story = {
  render: () => (
    <Stack gap={2}>
      <StatusBanner icon={<CloudOffIcon />} message="You're offline." tone="warning" />
      <StatusBanner icon={<AlertIcon />} message="Having trouble reaching the server." tone="warning" />
      <StatusBanner icon={<CloudOffIcon />} message="Back online — sending your queued picks…" tone="info" />
    </Stack>
  ),
};
