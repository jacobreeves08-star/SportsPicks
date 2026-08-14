import { Stack, Text, cx } from "../../design-system/index.js";
import styles from "./PickHorizonSelect.module.css";

export interface PickHorizonSelectProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  error?: string;
}

const PRESET_DAYS = [1, 2, 3, 5, 7, 14];

/**
 * A labeled preset `<select>` for `League.pickHorizonDays` — reused by
 * both `CreateLeagueScreen` (defaulting to 7) and `LeagueSettingsScreen`
 * (editing an existing league's value), matching `TimezoneSelect`'s
 * shape. Presets only, not a free-form number input: the server still
 * enforces the real 1-30 range, but a bounded picker avoids a member
 * fat-fingering something like 300 and wondering why nothing changed.
 */
export function PickHorizonSelect({ id, value, onChange, hint, error }: PickHorizonSelectProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <Stack gap={1}>
      <label htmlFor={id}>
        <Text size="sm" weight="medium">
          Pick horizon
        </Text>
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(styles.select, error && styles.selectError)}
      >
        {PRESET_DAYS.map((days) => (
          <option key={days} value={days}>
            {days === 1 ? "1 day ahead" : `${days} days ahead`}
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
