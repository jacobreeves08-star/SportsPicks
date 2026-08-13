import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils/cx.js";
import styles from "./Text.module.css";

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
export type TextWeight = "regular" | "medium" | "bold";
export type TextColor = "default" | "dim" | "pick-mine" | "hit" | "miss" | "locked" | "open" | "stale" | "error";

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  as?: "span" | "p" | "div" | "h1" | "h2" | "h3";
  size?: TextSize;
  weight?: TextWeight;
  color?: TextColor;
  /** Forces `font-variant-numeric: tabular-nums`. Prefer `NumericText`
   * for records/scores/ranks/countdowns — this flag exists so a
   * mixed string (e.g. "3rd place") can still align its digits
   * without pulling in NumericText's other defaults. */
  tabular?: boolean;
  className?: string;
  children: ReactNode;
}

export function Text({
  as = "span",
  size = "md",
  weight = "regular",
  color = "default",
  tabular = false,
  className,
  children,
  ...rest
}: TextProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cx(
        styles.text,
        styles[`size-${size}`],
        styles[`weight-${weight}`],
        styles[`color-${color}`],
        tabular && styles.tabular,
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
