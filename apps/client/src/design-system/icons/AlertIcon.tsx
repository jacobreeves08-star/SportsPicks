import { DEFAULT_ICON_SIZE, type IconProps } from "./icon-props.js";

/** Error state and (paired with a distinct label) stale-data banner. */
export function AlertIcon({ size = DEFAULT_ICON_SIZE, className }: IconProps) {
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
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.25" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
