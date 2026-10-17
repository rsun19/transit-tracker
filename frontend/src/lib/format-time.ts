// Transit times are shown in the agency's timezone, like station clocks,
// mbta.com and Google Maps, so a device on another timezone still reads the
// time the vehicle actually arrives at the stop.
export const DEFAULT_AGENCY_TIMEZONE = 'America/New_York';

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Clock time ("8:09 AM") in the given timezone. Seconds are truncated, as
 * mbta.com does. Returns the input unchanged if it isn't a valid date.
 */
export function formatClockTime(iso: string, timeZone = DEFAULT_AGENCY_TIMEZONE): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    } catch {
      // Unknown timezone name: fall back to the agency default.
      return formatClockTime(iso, DEFAULT_AGENCY_TIMEZONE);
    }
    formatters.set(timeZone, fmt);
  }
  return fmt.format(date);
}

/** "just now", "45 s ago", "3 min ago". */
export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 5) return 'just now';
  if (ageSeconds < 60) return `${Math.floor(ageSeconds)} s ago`;
  return `${Math.floor(ageSeconds / 60)} min ago`;
}
