import type { ReactNode } from "react";
import { Stack, Surface, Text } from "../design-system/index.js";
import styles from "./StandaloneLayout.module.css";

export interface StandaloneLayoutProps {
  title: string;
  children: ReactNode;
}

/**
 * The shared shell for every route that sits OUTSIDE `AppShell` —
 * every route not nested under `authenticatedLayoutRoute`
 * (docs/app-shell.md): auth screens, and the join deep-link flow
 * (code entry, invite preview), all reachable while logged out. A
 * single centered card, no bottom nav or banners. Built entirely from
 * existing primitives and tokens, no new design-system components,
 * matching every prior epic's layering rule.
 */
export function StandaloneLayout({ title, children }: StandaloneLayoutProps) {
  return (
    <main className={styles.page}>
      <Surface as="section" variant="raised" radius="lg" elevation={2} padding={5} className={styles.card}>
        <Stack gap={4}>
          <Text as="h1" size="lg" weight="bold">
            {title}
          </Text>
          {children}
        </Stack>
      </Surface>
    </main>
  );
}
