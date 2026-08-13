import { DEFAULT_ICON_SIZE, type IconProps } from "./icon-props.js";

/** Postponed/canceled games — see indicators/VoidBadge.tsx. */
export function CalendarOffIcon({ size = DEFAULT_ICON_SIZE, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="4" y="5.5" width="16" height="15" rx="1.5" />
      <path d="M4 10h16M8 3.5v3.5M16 3.5v3.5" />
      <path d="M8.5 14l7 5.5M15.5 14l-7 5.5" />
    </svg>
  );
}
