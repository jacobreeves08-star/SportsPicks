import type { HTMLAttributes, ReactNode } from "react";
import type { TextColor, TextSize, TextWeight } from "./Text.js";
import { Text } from "./Text.js";

export interface NumericTextProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  size?: TextSize;
  weight?: TextWeight;
  color?: TextColor;
  className?: string;
  children: ReactNode;
}

/**
 * The one place `font-variant-numeric: tabular-nums` gets applied for
 * records, scores, ranks, and countdowns (Epic 9 brief) — proportional
 * figures make a ticking countdown jitter and a standings column fail
 * to align. Always an inline `span`; records/scores/ranks/countdowns
 * live inside a row, not as their own block.
 */
export function NumericText({ size, weight, color, className, children, ...rest }: NumericTextProps) {
  return (
    <Text as="span" size={size} weight={weight} color={color} tabular className={className} {...rest}>
      {children}
    </Text>
  );
}
