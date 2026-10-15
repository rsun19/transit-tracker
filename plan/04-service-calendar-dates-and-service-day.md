# Ingest `calendar_dates.txt` and fix service-day time math

**Type:** bug fix (wrong schedules on holidays, special event days, and DST days)
**Touches:** `services/ingestion/src/gtfs-static.service.ts`, new entity `packages/shared/src/entities/service-calendar-date.entity.ts`, `docker/init-db.sql` (if tables are created there), `services/stops/src/stops.service.ts` (`today_services` CTE ×2), `services/routes/src/trips.service.ts`
**Depends on:** nothing; can go in parallel with PR 02 and PR 03

## Problem

1. **`calendar_dates.txt` is never ingested.** Only `calendar.txt` is loaded (`gtfs-static.service.ts:159`, `:508-545`), and the `today_services` CTE (`stops.service.ts:269-285`, `:690-702`) only checks weekday flags and the date range. The current MBTA feed has 143 `calendar_dates` rows: 98 removals and 45 additions. Exception dates are coming up on 2026-10-16/17/18/19, 10-24/25, 10-31, 11-01, **11-11 (Veterans Day)** and 11-20. On those days the app shows trips MBTA removed and leaves out the trips it added (holiday or Saturday-style schedules, shuttle and diversion services). MBTA's own site shows the correct set, so the times visibly disagree.
2. **The service day is computed from local midnight.** GTFS defines stop times relative to "noon minus 12h" on the service date. `(date + interval)::timestamp AT TIME ZONE tz` treats the time as a wall-clock time, which is off by an hour for times before 02:00 and for times ≥ 24:00 that cross a DST change. The next one is **Sunday 2026-11-01**. This is a small edge case, but the fix is cheap: `(date::timestamp + interval '12 hours') AT TIME ZONE tz - interval '12 hours' + st.arrival_time`.
3. **"Today" is computed in the Node process, not the agency timezone.** `stops.service.ts:254-256` builds `todayStr` and `yesterdayStr` with `Intl.DateTimeFormat(..., {timeZone})`, which is correct. But `yesterdayStr = now − 24h` is wrong on DST days (23- or 25-hour days). Derive yesterday from `todayStr` with date arithmetic instead.
4. **`trips.service.ts:60-61` uses `CURRENT_DATE`.** That's the DB server's date, and the Postgres container runs in UTC. After 20:00 ET (00:00 UTC), every trip-detail time shifts a day ahead. The result is also cached for an hour (`API_CACHE_ROUTES_TTL_S`), and `realtimeArrival` is just the scheduled time. Pass the service date in from the caller (agency timezone) and merge realtime with the PR 03 helper.

## Changes

1. Add the entity and table `service_calendar_dates (agency_id, service_id, date, exception_type)`, with an index on `(agency_id, date)`. Load it with `COPY` like `stop_times`, inside the same transaction as the other static tables, and add it to the delete list (`gtfs-static.service.ts:128-135`).
2. Rewrite `today_services`:
   ```sql
   WITH cand(d) AS (VALUES ($3::date), ($4::date)),
   today_services AS MATERIALIZED (
     SELECT sc.service_id, cand.d FROM service_calendars sc CROSS JOIN cand
     WHERE sc.agency_id = $2 AND cand.d BETWEEN sc.start_date AND sc.end_date
       AND <weekday flag for cand.d>
       AND NOT EXISTS (SELECT 1 FROM service_calendar_dates x
                       WHERE x.agency_id = $2 AND x.service_id = sc.service_id
                         AND x.date = cand.d AND x.exception_type = 2)
     UNION
     SELECT x.service_id, x.date FROM service_calendar_dates x JOIN cand ON x.date = cand.d
     WHERE x.agency_id = $2 AND x.exception_type = 1
   )
   ```
   Move it into one shared SQL fragment so both queries in `stops.service.ts` and `trips.service.ts` use the same definition.
3. Apply the noon-minus-12h fix to every `(d + st.arrival_time)` expression. There are 5 call sites, so a SQL function `gtfs_ts(d date, t interval, tz text)` would keep them consistent. Make it `IMMUTABLE`-safe or `STABLE`.
4. Fix the `yesterdayStr` computation.
5. Fix `trips.service.ts` to take a service date. Also make the trip-detail cache key include the service date, and shorten its TTL.

## Tests

- SQL-level test (testcontainers or the CI Postgres) covering: a service removed on a date (exception 2) doesn't appear; a calendar_dates-only service (exception 1) does.
- DST: on 2026-11-01, a trip at `08:00:00` resolves to `13:00Z`, and a trip at `25:30:00` on 2026-10-31 resolves to `2026-11-01T05:30Z`.
- Unit test for the `yesterday` derivation on DST days.
