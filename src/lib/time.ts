/**
 * Ethiopia has no DST (UTC+3 all year), so simple offset arithmetic is exact.
 * Laravel equivalents used by the bot: now('Africa/Addis_Ababa'), format('oW'),
 * startOfDay, timezone('Africa/Addis_Ababa')->format('M j, Y').
 */

const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

/** "Wall clock in Addis" expressed as a shifted Date (read its UTC fields). */
export function addisNow(): Date {
  return new Date(Date.now() + ADDIS_OFFSET_MS);
}

/** Start of the current Addis Ababa day, as a real UTC instant. */
export function addisMidnightUtc(): Date {
  const shifted = addisNow();
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnight - ADDIS_OFFSET_MS);
}

/** ISO week id: Laravel format('oW') — ISO year followed by 2-digit week. */
export function isoWeekId(date = addisNow()): number {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  // Thursday of the current ISO week determines the year+week.
  const day = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil((((d.getTime() - jan1) / 86400000) + 1) / 7);
  return year * 100 + week;
}

/** Format a UTC instant as "M j, Y" in Addis (e.g. "Oct 22, 2026"). */
export function formatAddis(date: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const local = new Date(date.getTime() + ADDIS_OFFSET_MS);
  return `${months[local.getUTCMonth()]} ${local.getUTCDate()}, ${local.getUTCFullYear()}`;
}

/** Seconds remaining until `expiresAt` (0 when finished/past). */
export function secondsLeft(expiresAt: Date | null | undefined): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}
