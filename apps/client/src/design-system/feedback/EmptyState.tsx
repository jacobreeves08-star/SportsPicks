import type { ReactNode } from "react";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** A slot for a call-to-action, e.g. a "Join a league" button — no
   * fetch/navigation logic belongs in this component. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <Stack gap={3} align="center" className={cx(styles.empty, className)}>
      <Text as="p" size="lg" weight="bold">
        {title}
      </Text>
      {description ? (
        <Text as="p" color="dim">
          {description}
        </Text>
      ) : null}
      {action}
    </Stack>
  );
}
