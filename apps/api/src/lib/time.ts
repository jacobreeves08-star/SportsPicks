import { DateTime } from "luxon";

/**
 * All timestamps are stored and passed around the system as UTC.
 * Conversion to a user's or league's local timezone happens only
 * at the presentation boundary (API response formatting / UI), via
 * `toZonedDisplay` below — never in storage or business logic.
 */

export function nowUtc(): DateTime {
  return DateTime.utc();
}

export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: false }) as string;
}

export function parseIsoUtc(iso: string): DateTime {
  const dt = DateTime.fromISO(iso, { zone: "utc" });
  if (!dt.isValid) {
    throw new Error(`Invalid ISO-8601 timestamp: ${iso} (${dt.invalidReason})`);
  }
  return dt;
}

export function toZonedDisplay(dt: DateTime, ianaTimeZone: string): DateTime {
  return dt.setZone(ianaTimeZone);
}

export function isValidIanaTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
