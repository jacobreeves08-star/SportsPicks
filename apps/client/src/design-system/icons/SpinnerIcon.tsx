import { DEFAULT_ICON_SIZE, type IconProps } from "./icon-props.js";

/**
 * The static ring shape only — `feedback/Spinner.tsx` applies the
 * rotation animation (and skips it under reduced motion). Kept
 * separate so the shape itself is reusable/testable without also
 * pulling in the reduced-motion branching logic.
 */
export function SpinnerIcon({ size = DEFAULT_ICON_SIZE, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
