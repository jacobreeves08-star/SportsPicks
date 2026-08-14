/**
 * IANA timezone selection — used by the signup screen's "defaulted
 * from browser, briefly explained" timezone field (Epic 11 brief) and
 * by the profile settings screen's timezone editor (same epic, later
 * step). `Intl.supportedValuesOf` is a modern, broadly-supported
 * browser API (Chrome 99+, Firefox 93+, Safari 15.4+) — this app
 * already assumes evergreen browser APIs elsewhere (fetch,
 * Notification, matchMedia), so no polyfill or library. Falls back to
 * a list containing only the detected zone when the API itself is
 * unavailable, rather than crashing the screen that needs it.
 */
export function getDetectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * The detected zone is always guaranteed to be present in the
 * returned list, even though `Intl.supportedValuesOf("timeZone")`
 * does NOT itself always include it — confirmed empirically that
 * "UTC" (a common detected zone in a server/CI environment with no
 * TZ set) is absent from that list's canonical IANA names in this
 * Node version. Without this, a `<select>` defaulted to the detected
 * zone would have no matching `<option>`.
 */
export function listTimezones(): string[] {
  const detected = getDetectedTimezone();
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const zones = Intl.supportedValuesOf("timeZone");
      return zones.includes(detected) ? zones : [detected, ...zones];
    }
  } catch {
    // fall through to the single-zone fallback below
  }
  return [detected];
}
