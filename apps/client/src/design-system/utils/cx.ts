/**
 * A tiny classnames combiner — no dependency worth taking for this.
 * Falsy values are skipped, so conditional classes read as
 * `cx(styles.base, isOpen && styles.open)`.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter((c): c is string => Boolean(c)).join(" ");
}
