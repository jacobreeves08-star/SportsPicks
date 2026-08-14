import { contrastRatio } from "../tokens/contrast.js";

const HEX6 = /^[0-9a-fA-F]{6}$/;

/** Below this, a team's color reads as nearly indistinguishable from
 * the page background — a filled "selected" side would look broken
 * (present in the DOM, invisible on screen) rather than just plain.
 * Mirrors --color-surface (tokens.css); duplicated as a literal since
 * this file works with raw hex math, same reasoning as contrast.ts
 * itself parsing tokens.css rather than reading computed CSS vars. */
const SURFACE_HEX = "#0a0a0b";
const MIN_CONTRAST_AGAINST_SURFACE = 1.5;

export interface TeamSelectionStyle {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

/**
 * Given a team's ESPN-provided primary color (6 hex digits, no '#'),
 * returns the inline style for rendering a PickControl side filled in
 * that team's own color when selected — or null when there's no
 * usable color, so the caller falls back to the plain accent fill
 * instead of rendering nothing/something broken.
 *
 * The text/icon color is picked as whichever of pure black or white
 * contrasts better against the team color — real brand colors span
 * the whole lightness range (a pale color needs dark text, a navy
 * needs white), so no single fixed choice works for every team the
 * way it does for the app's own single accent color.
 */
export function teamSelectionStyle(colorHex: string | null | undefined): TeamSelectionStyle | null {
  if (!colorHex || !HEX6.test(colorHex)) return null;
  const background = `#${colorHex}`;
  if (contrastRatio(background, SURFACE_HEX) < MIN_CONTRAST_AGAINST_SURFACE) return null;
  const textColor = contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff") ? "#000000" : "#ffffff";
  return { backgroundColor: background, borderColor: background, color: textColor };
}
