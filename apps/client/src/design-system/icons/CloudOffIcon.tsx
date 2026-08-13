import { DEFAULT_ICON_SIZE, type IconProps } from "./icon-props.js";

/** Offline/unsynced — the "not saved yet" signal for a queued pick. */
export function CloudOffIcon({ size = DEFAULT_ICON_SIZE, className }: IconProps) {
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
      <path d="M7.5 18h9.5a3.5 3.5 0 0 0 .87-6.89 5 5 0 0 0-9.4-2.36A4 4 0 0 0 5 12.5" />
      <path d="M4 4l16 16" />
    </svg>
  );
}
