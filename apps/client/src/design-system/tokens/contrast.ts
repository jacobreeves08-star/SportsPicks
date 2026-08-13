/**
 * Hand-rolled WCAG 2.x relative-luminance / contrast-ratio math — the
 * standard W3C formula (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance),
 * not a package. Two reasons: (1) it's ~30 lines and fully
 * deterministic, no dependency worth taking for that; (2) axe-core's
 * own `color-contrast` rule is NOT reliable under jsdom (this
 * workspace's test environment) since jsdom's `getComputedStyle`
 * doesn't do real layout/paint — this is the actually-trustworthy way
 * to gate contrast in CI, verified against real hex values from
 * tokens.css rather than a rendered DOM node.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match?.[1]) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: Rgb): number {
  const r = srgbChannelToLinear(color.r);
  const g = srgbChannelToLinear(color.g);
  const b = srgbChannelToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA thresholds: 4.5:1 for normal text, 3:1 for large text
 * (≥18pt / 14pt bold) and non-text UI components (borders, focus
 * rings, icons that convey meaning on their own). */
export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT_OR_UI = 3.0;

export function meetsAA(a: string, b: string, level: "normal" | "large-or-ui"): boolean {
  const threshold = level === "normal" ? AA_NORMAL_TEXT : AA_LARGE_TEXT_OR_UI;
  return contrastRatio(a, b) >= threshold;
}
