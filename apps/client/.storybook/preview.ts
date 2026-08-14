import type { Decorator, Preview } from "@storybook/react-vite";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import "../src/design-system/tokens/tokens.css";
import "../src/design-system/base.css";

/**
 * Epic 9's design target ("used one-handed, on a phone, in a bar") means
 * the gallery should open in a phone-sized frame by default, not the
 * desktop-sized default every Storybook ships with. `phone` (375x812)
 * is listed first and set as the initial global so opening Storybook
 * cold already shows what a reviewer on a real phone will see.
 */
const viewportOptions = {
  phone: {
    name: "Phone (375x812)",
    styles: { width: "375px", height: "812px" },
    type: "mobile" as const,
  },
  ...INITIAL_VIEWPORTS,
};

/**
 * A manual toolbar toggle for `prefers-reduced-motion`, since Storybook
 * has no way to flip the real OS media query on demand. Wired to the
 * SAME `data-motion="reduce"` selector tokens.css's real
 * `@media (prefers-reduced-motion: reduce)` block also targets (see
 * tokens.css's own comment) — one CSS mechanism, two ways to trigger
 * it, so this toggle previews exactly what the real media query does
 * rather than a parallel, possibly-diverging approximation.
 */
const withReducedMotion: Decorator = (Story, context) => {
  document.documentElement.dataset.motion = context.globals.motion === "reduce" ? "reduce" : "";
  return Story();
};

const preview: Preview = {
  parameters: {
    viewport: { options: viewportOptions },
    a11y: {
      // Fail the interactive panel loudly rather than silently, but
      // never block `npm run build-storybook` — this is the manual-
      // review layer, not the CI-gating layer (jest-axe component
      // tests are that layer; see docs/design-system.md).
      test: "todo",
    },
  },
  globalTypes: {
    motion: {
      name: "Motion",
      description: "Preview prefers-reduced-motion: reduce without changing OS settings",
      toolbar: {
        icon: "lightning",
        items: [
          { value: "no-preference", title: "Motion: normal" },
          { value: "reduce", title: "Motion: reduced" },
        ],
      },
    },
  },
  initialGlobals: {
    viewport: { value: "phone", isRotated: false },
    motion: "no-preference",
  },
  decorators: [withReducedMotion],
};

export default preview;
