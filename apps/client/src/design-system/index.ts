/**
 * The whole design system, re-exported from one place. Epics 10-11
 * import from `src/design-system` rather than reaching into
 * individual subdirectories — this barrel is the public surface;
 * everything else (module-internal helpers, `.module.css` files) is
 * an implementation detail.
 */
export * from "./feedback/index.js";
export * from "./icons/index.js";
export * from "./indicators/index.js";
export * from "./pick-control/index.js";
export * from "./primitives/index.js";
export { contrastRatio, hexToRgb, meetsAA, relativeLuminance, type Rgb } from "./tokens/contrast.js";
export {
  colorToken,
  elevationToken,
  motionToken,
  radiusToken,
  spaceToken,
} from "./tokens/token-names.js";
export { cx } from "./utils/cx.js";
export { useReducedMotion } from "./utils/use-reduced-motion.js";
