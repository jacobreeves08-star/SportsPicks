import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Epic 9 deliverable: "a component gallery/storybook I can review on a
 * real phone." `@storybook/react-vite` reuses this workspace's existing
 * Vite pipeline (same plugin, same CSS Modules support) — zero extra
 * bundler config needed. `@storybook/addon-essentials` is deliberately
 * NOT installed: as of Storybook 9 its addons (controls, actions,
 * viewport, backgrounds, docs) were folded into core and the package
 * itself stopped publishing past `9.0.0-alpha.12` — installing it
 * against Storybook 10 fails dependency resolution outright (confirmed
 * empirically, not assumed).
 */
const config: StorybookConfig = {
  stories: ["../src/design-system/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
