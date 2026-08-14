import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils/cx.js";
import styles from "./Surface.module.css";

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  as?: "div" | "section" | "article" | "li";
  /** `surface` = page background; `raised` = a card/row sitting on
   * top of it, with a visible border. */
  variant?: "surface" | "raised";
  radius?: "none" | "sm" | "md" | "lg" | "full";
  elevation?: 0 | 1 | 2;
  padding?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  children: ReactNode;
}

export function Surface({
  as = "div",
  variant = "surface",
  radius = "md",
  elevation,
  padding,
  className,
  children,
  ...rest
}: SurfaceProps) {
  const Component = as as ElementType;
  // A "raised" surface reads as a card and gets a soft shadow by
  // default — requiring every call site to separately opt in via
  // `elevation` for the one variant whose whole point is looking
  // lifted off the page is friction a design system shouldn't impose.
  // Still fully overridable (a caller can pass `elevation={0}` to flatten
  // a raised surface deliberately, e.g. inside another card).
  const resolvedElevation = elevation ?? (variant === "raised" ? 1 : 0);
  return (
    <Component
      className={cx(
        styles.surface,
        styles[`variant-${variant}`],
        styles[`radius-${radius}`],
        styles[`elevation-${resolvedElevation}`],
        padding !== undefined && styles[`padding-${padding}`],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
