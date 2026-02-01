/**
 * Parse ISO string as UTC (append Z if no timezone) so countdowns are correct in any timezone.
 */
export function parseUTC(iso: string | null | undefined): number {
  if (!iso) return 0;
  const s = iso.trim();
  if (!/Z$|[-+]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s + "Z").getTime();
  }
  return new Date(s).getTime();
}

/**
 * Format ISO datetime in user's local timezone, date + time without seconds.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = iso.trim();
  const date = /Z$|[-+]\d{2}:?\d{2}$/.test(s) ? new Date(s) : new Date(s + "Z");
  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
