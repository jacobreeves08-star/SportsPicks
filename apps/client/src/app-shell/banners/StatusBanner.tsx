import type { ReactNode } from "react";
import { Stack, Text, cx } from "../../design-system/index.js";
import styles from "./StatusBanner.module.css";

export interface StatusBannerProps {
  icon: ReactNode;
  message: string;
  /** `warning` uses the existing `--color-error` token (offline/degraded
   * are error-adjacent conditions — a better semantic fit than
   * stretching an unrelated token, and adds zero new tokens to the
   * design system). `info` uses the existing `--color-text-dim`. */
  tone: "warning" | "info";
  /** `alert` for something that just started needing attention,
   * `status` (default) for an ongoing condition — matches the native
   * ARIA live-region urgency difference. */
  role?: "status" | "alert";
  className?: string;
}

/**
 * The one non-`StaleBanner` shape the global banner system renders —
 * offline/degraded/reconnecting/unsaved-picks all use this. Built
 * entirely from existing design-system primitives/tokens (Epic 9's
 * architecture rule: no new design-system components from a container
 * layer) — this lives in app-shell/, not design-system/.
 */
export function StatusBanner({ icon, message, tone, role = "status", className }: StatusBannerProps) {
  return (
    <Stack
      direction="row"
      gap={2}
      align="center"
      role={role}
      className={cx(styles.banner, styles[`tone-${tone}`], className)}
    >
      <span className={tone === "warning" ? styles["icon-warning"] : styles["icon-info"]}>{icon}</span>
      <Text size="sm" weight="medium">
        {message}
      </Text>
    </Stack>
  );
}
