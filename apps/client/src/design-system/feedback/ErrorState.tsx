import { AlertIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./ErrorState.module.css";

export interface ErrorStateProps {
  message: string;
  /** No fetch/retry logic lives here — this component only renders
   * the button and calls back; a container (Epic 10/11) owns what
   * "retry" actually does (e.g. `queryClient.refetchQueries`). */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ message, onRetry, retryLabel = "Try again", className }: ErrorStateProps) {
  return (
    <Stack gap={3} align="center" className={cx(styles.error, className)} role="alert">
      <AlertIcon size={28} className={styles.icon} />
      <Text as="p" weight="medium">
        {message}
      </Text>
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </Stack>
  );
}
