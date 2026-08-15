/**
 * The logged-out marketing chrome, re-exported from one place — the
 * same barrel convention `design-system/index.ts` uses. A screen
 * composes `MarketingHeader` + its own hero + `MarketingSections` +
 * `MarketingFooter`; the stylesheet and content module are internal.
 */
export { MarketingFooter, type MarketingFooterProps } from "./MarketingFooter.js";
export { MarketingHeader, type MarketingHeaderProps } from "./MarketingHeader.js";
export { MarketingSections, type MarketingSectionsProps } from "./MarketingSections.js";
export {
  MARKETING_FAQS,
  MARKETING_FEATURES,
  MARKETING_SPORTS,
  MARKETING_STATS,
  MARKETING_STEPS,
  SPORT_COUNT,
  type MarketingFaq,
  type MarketingFeature,
  type MarketingStat,
  type MarketingStep,
} from "./marketing-content.js";
