/**
 * Typed `var(--...)` constants for the rare case a component needs a
 * token in an inline style rather than a `.module.css` rule (most
 * components just write `var(--color-x)` directly in CSS and never
 * import this file). This file does NOT hold values — `tokens.css` is
 * the only source of truth; `token-names.test.ts` asserts every name
 * referenced here actually exists in `tokens.css`, so the two can
 * never silently drift apart.
 */
export const colorToken = {
  surface: "var(--color-surface)",
  surfaceRaised: "var(--color-surface-raised)",
  border: "var(--color-border)",
  text: "var(--color-text)",
  textDim: "var(--color-text-dim)",
  pickMine: "var(--color-pick-mine)",
  resultHit: "var(--color-result-hit)",
  resultMiss: "var(--color-result-miss)",
  stateLocked: "var(--color-state-locked)",
  stateOpen: "var(--color-state-open)",
  stateStale: "var(--color-state-stale)",
  error: "var(--color-error)",
  focusRing: "var(--color-focus-ring)",
} as const;

export const spaceToken = {
  1: "var(--space-1)",
  2: "var(--space-2)",
  3: "var(--space-3)",
  4: "var(--space-4)",
  5: "var(--space-5)",
  6: "var(--space-6)",
  7: "var(--space-7)",
  8: "var(--space-8)",
} as const;

export const radiusToken = {
  sm: "var(--radius-sm)",
  md: "var(--radius-md)",
  lg: "var(--radius-lg)",
  full: "var(--radius-full)",
} as const;

export const elevationToken = {
  0: "var(--elevation-0)",
  1: "var(--elevation-1)",
  2: "var(--elevation-2)",
} as const;

export const motionToken = {
  fast: "var(--motion-duration-fast)",
  base: "var(--motion-duration-base)",
} as const;
