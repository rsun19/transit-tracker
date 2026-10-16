// GTFS service-day helpers shared by every service that expands stop_times to
// real timestamps. Keeping them in one place stops the SQL definitions of
// "active service" and "stop time on a service day" from drifting apart.

const DAY_MS = 86_400_000;

/**
 * Calendar date (YYYY-MM-DD) in the given IANA timezone at `now`.
 */
export function localDate(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

/**
 * Shifts a YYYY-MM-DD date by whole calendar days. Pure date arithmetic, so a
 * 23- or 25-hour DST day can't land on the wrong date the way `now - 24h` can.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The two service days that can have trips running at `now`: today, and
 * yesterday (whose trips run past midnight with times ≥ 24:00:00).
 */
export function candidateServiceDates(
  timezone: string,
  now: Date = new Date(),
): { today: string; yesterday: string } {
  const today = localDate(timezone, now);
  return { today, yesterday: addDays(today, -1) };
}

/**
 * SQL for a GTFS stop time as timestamptz. GTFS times are measured from
 * "noon minus 12h" on the service date, not from midnight, so this stays
 * right for times before 02:00 and past 24:00 on DST change days.
 * Arguments are SQL expressions (columns or placeholders).
 */
export const gtfsTimestampSql = (date: string, time: string, tz: string) =>
  `(((${date})::date::timestamp + interval '12 hours') AT TIME ZONE (${tz}) - interval '12 hours' + (${time}))`;

/**
 * A MATERIALIZED CTE named `today_services` with columns (service_id,
 * agency_id, d): every service active on each of the given dates, from
 * calendar.txt weekday ranges minus calendar_dates removals (exception_type 2)
 * plus calendar_dates additions (exception_type 1).
 * Arguments are SQL expressions (placeholders), one per candidate date.
 */
export const activeServicesCte = (agency: string, dates: string[]) => {
  const values = dates.map((d) => `(${d}::date)`).join(', ');
  return `
  today_services AS MATERIALIZED (
    SELECT sc.service_id, sc.agency_id, cand.d
    FROM service_calendars sc
    CROSS JOIN (VALUES ${values}) AS cand(d)
    WHERE sc.agency_id = ${agency}
      AND cand.d BETWEEN sc.start_date AND sc.end_date
      AND CASE EXTRACT(DOW FROM cand.d)::int
            WHEN 0 THEN sc.sunday
            WHEN 1 THEN sc.monday
            WHEN 2 THEN sc.tuesday
            WHEN 3 THEN sc.wednesday
            WHEN 4 THEN sc.thursday
            WHEN 5 THEN sc.friday
            WHEN 6 THEN sc.saturday
          END = true
      AND NOT EXISTS (
        SELECT 1 FROM service_calendar_dates x
        WHERE x.agency_id = sc.agency_id AND x.service_id = sc.service_id
          AND x.date = cand.d AND x.exception_type = 2
      )
    UNION
    SELECT x.service_id, x.agency_id, cand.d
    FROM service_calendar_dates x
    JOIN (VALUES ${values}) AS cand(d) ON x.date = cand.d
    WHERE x.agency_id = ${agency} AND x.exception_type = 1
  )`;
};
