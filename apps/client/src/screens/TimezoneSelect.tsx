import { useMemo } from "react";
import { Stack, Text, cx } from "../design-system/index.js";
import { listTimezones } from "../timezone/timezones.js";
import styles from "./TimezoneSelect.module.css";

export interface TimezoneSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}

/**
 * A labeled IANA timezone `<select>` — reused across every screen that
 * captures a timezone (signup, league create, profile settings), the
 * third occurrence being the trigger to promote this out of a
 * per-screen duplicate (SignupScreen and CreateLeagueScreen each had
 * their own identical `.select` CSS + `listTimezones()` call before
 * this). Screens-local, same "container built from primitives"
 * boundary as `FormField`.
 */
export function TimezoneSelect({ id, label, value, onChange, hint, error }: TimezoneSelectProps) {
  const timezones = useMemo(() => listTimezones(), []);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <Stack gap={1}>
      <label htmlFor={id}>
        <Text size="sm" weight="medium">
          {label}
        </Text>
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(styles.select, error && styles.selectError)}
      >
        {timezones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {hint ? (
        <Text id={hintId} size="xs" color="dim">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text id={errorId} size="xs" color="error" role="alert">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
