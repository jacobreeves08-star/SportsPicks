import { DEFAULT_ICON_SIZE, type IconProps } from "./icon-props.js";

/** The bottom-nav "all leagues" destination. */
export function HomeIcon({ size = DEFAULT_ICON_SIZE, className }: IconProps) {
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
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5a2 2 0 0 1 4 0V20h3a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}
