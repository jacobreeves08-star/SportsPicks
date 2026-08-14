import { Stack, Text, cx } from "../design-system/index.js";
import styles from "./FormField.module.css";

export interface FormFieldProps {
  id: string;
  label: string;
  type?: "text" | "email" | "password" | "date";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
}

/**
 * A labeled text input with an optional hint and error — reused across
 * every screen that submits a form (auth screens first; league
 * create/join next) so the label/input/error association is built
 * correctly exactly once. No new design-system component — this is
 * screens-local, the same "container built from primitives" boundary
 * Epic 10's `notifications/PreferencesForm.tsx` already established.
 */
export function FormField({ id, label, type = "text", value, onChange, error, hint, autoComplete, required }: FormFieldProps) {
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
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(styles.input, error && styles.inputError)}
      />
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
