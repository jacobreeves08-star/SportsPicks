import { Stack, Text, cx } from "../../design-system/index.js";
import styles from "./PickHorizonSelect.module.css";

export interface GolfSettingsFieldsProps {
  golfPickCount: number;
  golfTopN: number;
  onPickCountChange: (value: number) => void;
  onTopNChange: (value: number) => void;
  errors?: Record<string, string>;
}

const PICK_COUNT_OPTIONS = [1, 2, 3, 4, 5];
const TOP_N_OPTIONS = [5, 10, 15, 20, 25];

/**
 * The two per-league golf settings, shown by both `CreateLeagueScreen`
 * and `LeagueSettingsScreen` (and only when the league actually covers
 * golf). Presets rather than free-form numbers, same reasoning as
 * `PickHorizonSelect` — the server enforces the real ranges (1-10 and
 * 1-50), this just keeps the common choices one tap away. Reuses that
 * component's stylesheet rather than duplicating an identical one.
 */
export function GolfSettingsFields({
  golfPickCount,
  golfTopN,
  onPickCountChange,
  onTopNChange,
  errors = {},
}: GolfSettingsFieldsProps) {
  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <label htmlFor="golf-pick-count">
          <Text size="sm" weight="medium">
            Golfers per tournament
          </Text>
        </label>
        <select
          id="golf-pick-count"
          value={golfPickCount}
          onChange={(event) => onPickCountChange(Number(event.target.value))}
          aria-invalid={errors.golfPickCount ? true : undefined}
          className={cx(styles.select, errors.golfPickCount && styles.selectError)}
        >
          {PICK_COUNT_OPTIONS.map((count) => (
            <option key={count} value={count}>
              {count === 1 ? "1 golfer" : `${count} golfers`}
            </option>
          ))}
        </select>
        <Text size="xs" color="dim">
          How many golfers each member picks before a tournament starts.
        </Text>
        {errors.golfPickCount ? (
          <Text size="xs" color="error" role="alert">
            {errors.golfPickCount}
          </Text>
        ) : null}
      </Stack>

      <Stack gap={1}>
        <label htmlFor="golf-top-n">
          <Text size="sm" weight="medium">
            Winning finish
          </Text>
        </label>
        <select
          id="golf-top-n"
          value={golfTopN}
          onChange={(event) => onTopNChange(Number(event.target.value))}
          aria-invalid={errors.golfTopN ? true : undefined}
          className={cx(styles.select, errors.golfTopN && styles.selectError)}
        >
          {TOP_N_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
        <Text size="xs" color="dim">
          A member wins the tournament if any of their golfers finishes this high.
        </Text>
        {errors.golfTopN ? (
          <Text size="xs" color="error" role="alert">
            {errors.golfTopN}
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}
