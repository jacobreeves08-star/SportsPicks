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

/**
 * The UTC instant range for one calendar day in a given IANA timezone
 * — e.g. "today's slate" (JAC-31) needs the league's timezone, not UTC
 * and not the viewer's device, to decide which games fall on which
 * day. `end` is exclusive (the start of the NEXT day).
 */
export function dayBoundsUtc(date: string, ianaTimeZone: string): { start: Date; end: Date } {
  const startOfDay = DateTime.fromISO(date, { zone: ianaTimeZone }).startOf("day");
  if (!startOfDay.isValid) {
    throw new Error(`Invalid date "${date}" or timezone "${ianaTimeZone}": ${startOfDay.invalidReason}`);
  }
  return { start: startOfDay.toUTC().toJSDate(), end: startOfDay.plus({ days: 1 }).toUTC().toJSDate() };
}
