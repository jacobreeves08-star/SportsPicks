import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAA } from "./contrast.js";

/**
 * Parses tokens.css directly for hex values — no duplicated value
 * table. Only matches simple `--name: #rrggbb;` declarations (every
 * color token in tokens.css is written this way); non-color tokens
 * (spacing, shadows) aren't hex and are simply absent from this map,
 * which is fine since this test only checks color pairings.
 *
 * `fileURLToPath(import.meta.url)` (a plain string) + `path.join`,
 * NOT `new URL("./tokens.css", import.meta.url)` — under this
 * workspace's jsdom test environment, jsdom's global `URL` polyfill
 * shadows Node's, and Node's `fileURLToPath` rejects a URL object it
 * didn't construct itself ("The URL must be of scheme file," even
 * though the URL genuinely is one) — confirmed empirically. Passing
 * `import.meta.url` as a plain string sidesteps the polyfill entirely.
 */
function parseColorTokens(): Map<string, string> {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "tokens.css");
  const css = readFileSync(cssPath, "utf8");
  const colors = new Map<string, string>();
  for (const match of css.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (match[1] && match[2]) colors.set(match[1], match[2]);
  }
  return colors;
}

/**
 * Every semantic pairing this design system actually renders. "normal"
 * = the token is used as normal-size text/icon-with-text (4.5:1);
 * "large-or-ui" = the token is used only as a non-text UI element
 * (borders, focus rings — 3:1 per WCAG 2.4.11). Extend this list
 * whenever a new component introduces a new foreground/background
 * pairing — the whole point of parsing tokens.css directly is that
 * this list, not a screenshot, is the actual accessibility gate.
 */
const PAIRINGS: Array<{ fg: string; bg: string; level: "normal" | "large-or-ui" }> = [
  { fg: "--color-text", bg: "--color-surface", level: "normal" },
  { fg: "--color-text", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-text-dim", bg: "--color-surface", level: "normal" },
  { fg: "--color-text-dim", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-pick-mine", bg: "--color-surface", level: "normal" },
  { fg: "--color-pick-mine", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-result-hit", bg: "--color-surface", level: "normal" },
  { fg: "--color-result-hit", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-result-miss", bg: "--color-surface", level: "normal" },
  { fg: "--color-result-miss", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-state-locked", bg: "--color-surface", level: "normal" },
  { fg: "--color-state-locked", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-state-open", bg: "--color-surface", level: "normal" },
  { fg: "--color-state-open", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-state-stale", bg: "--color-surface", level: "normal" },
  { fg: "--color-state-stale", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-error", bg: "--color-surface", level: "normal" },
  { fg: "--color-error", bg: "--color-surface-raised", level: "normal" },
  { fg: "--color-border", bg: "--color-surface-raised", level: "large-or-ui" },
  { fg: "--color-border", bg: "--color-surface", level: "large-or-ui" },
  { fg: "--color-focus-ring", bg: "--color-surface-raised", level: "large-or-ui" },
  { fg: "--color-focus-ring", bg: "--color-surface", level: "large-or-ui" },
];

describe("WCAG AA contrast — every semantic token pairing", () => {
  const colors = parseColorTokens();

  it.each(PAIRINGS)("$fg on $bg meets AA ($level)", ({ fg, bg, level }) => {
    const fgHex = colors.get(fg);
    const bgHex = colors.get(bg);
    expect(fgHex, `${fg} not found in tokens.css`).toBeDefined();
    expect(bgHex, `${bg} not found in tokens.css`).toBeDefined();

    const ratio = contrastRatio(fgHex!, bgHex!);
    const passes = meetsAA(fgHex!, bgHex!, level);
    const threshold = level === "normal" ? "4.5:1" : "3:1";
    expect(passes, `${fg} (${fgHex}) on ${bg} (${bgHex}) is ${ratio.toFixed(2)}:1, needs ${threshold}`).toBe(true);
  });
});
