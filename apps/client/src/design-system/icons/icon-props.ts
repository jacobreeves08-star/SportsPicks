export interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Every icon in this set is decorative by construction (`aria-hidden`,
 * `currentColor` fill/stroke) — the ACCESSIBLE name always comes from
 * adjacent text (a `ResultBadge`'s "Correct"/"Incorrect" label, a
 * `PickControl` side's own name), never from the icon alone. This is
 * what "never color-only" (Epic 9 brief) actually means in practice:
 * the icon is a second, independent signal alongside color, and the
 * text is the accessible one both a screen reader and a colorblind
 * user without the icon's shape memorized can rely on.
 */
export const DEFAULT_ICON_SIZE = 20;
