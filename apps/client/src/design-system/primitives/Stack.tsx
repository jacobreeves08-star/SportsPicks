import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils/cx.js";
import styles from "./Stack.module.css";

export type SpaceKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface StackProps extends Omit<HTMLAttributes<HTMLElement>, "className" | "children"> {
  as?: "div" | "section" | "ul" | "li";
  direction?: "row" | "column";
  gap?: SpaceKey;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  className?: string;
  children: ReactNode;
}

/** Flex layout primitive — every gap is a spacing token, never a raw
 * pixel value written at the call site. Forwards arbitrary HTML/ARIA
 * attributes (`role`, `aria-*`, `id`, ...) so composing components
 * (e.g. PickControl's `role="radiogroup"` row) can build proper
 * semantics on top of it. */
export function Stack({
  as = "div",
  direction = "column",
  gap = 3,
  align = "stretch",
  justify = "start",
  wrap = false,
  className,
  children,
  ...rest
}: StackProps) {
  const Component = as as ElementType;
  return (
    <Component
      className={cx(
        styles.stack,
        styles[`direction-${direction}`],
        styles[`align-${align}`],
        styles[`justify-${justify}`],
        styles[`gap-${gap}`],
        wrap && styles.wrap,
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
