import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colorToken, elevationToken, motionToken, radiusToken, spaceToken } from "./token-names.js";

/**
 * The drift check: every `var(--x)` string in token-names.ts must name
 * a custom property that actually exists in tokens.css. tokens.css is
 * parsed directly (not duplicated into a second value table) so this
 * test fails the moment the two files disagree, rather than silently
 * shipping a `var()` reference to a token that was renamed or removed.
 *
 * See contrast.test.ts's `parseColorTokens` comment for why this uses
 * `fileURLToPath(import.meta.url)` + `path.join` rather than
 * `new URL("./tokens.css", import.meta.url)` — the latter fails under
 * this workspace's jsdom test environment.
 */
function definedCustomProperties(): Set<string> {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "tokens.css");
  const css = readFileSync(cssPath, "utf8");
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:/g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

function referencedNames(values: Record<string | number, string>): string[] {
  return Object.values(values).map((v) => {
    const match = /^var\((--[\w-]+)\)$/.exec(v);
    if (!match?.[1]) throw new Error(`Not a var(--x) reference: ${v}`);
    return match[1];
  });
}

describe("token-names.ts drift check", () => {
  it("every referenced custom property is defined in tokens.css", () => {
    const defined = definedCustomProperties();
    const referenced = [
      ...referencedNames(colorToken),
      ...referencedNames(spaceToken),
      ...referencedNames(radiusToken),
      ...referencedNames(elevationToken),
      ...referencedNames(motionToken),
    ];

    for (const name of referenced) {
      expect(defined.has(name), `${name} is referenced in token-names.ts but not defined in tokens.css`).toBe(true);
    }
  });

  it("tokens.css defines at least the color tokens the design system's own vocabulary requires", () => {
    const defined = definedCustomProperties();
    const required = [
      "--color-pick-mine",
      "--color-result-hit",
      "--color-result-miss",
      "--color-state-locked",
      "--color-state-open",
      "--color-state-stale",
      "--color-surface",
      "--color-surface-raised",
      "--color-border",
      "--color-text",
      "--color-text-dim",
    ];
    for (const name of required) {
      expect(defined.has(name), `${name} (Epic 9 brief's required token list) missing from tokens.css`).toBe(true);
    }
  });
});
