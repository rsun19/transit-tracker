# Precompute active services per date (`service_dates`)

**Type:** performance, plus a new table
**Touches:** new migration (`service_dates`), `services/ingestion/src/gtfs-static.service.ts` (derived table in staging), `packages/shared/src/service-day.ts` (`activeServicesCte`), `services/stops/src/stops.service.ts`, `services/routes/src/trips.service.ts`
**Depends on:** plan 07 (staging), plan 08 (migrations)

## Problem

1. **Every arrivals, nearby and trip-detail request recomputes which services run today and yesterday.**
   - `activeServicesCte` (`service-day.ts:51`) evaluates a weekday `CASE` over `service_calendars`, anti-joins `service_calendar_dates` removals, and unions the additions.
   - It's used at `stops.service.ts:353` and `:776`, and at `trips.service.ts:152`.
2. **The planner can't estimate it, and picks a slow join order.**
   - The CTE is `MATERIALIZED`, so the planner has no row estimate for it.
   - For arrivals at Park Street, it starts from the services and walks **70 services → 33,279 trips → one `stop_times` probe per trip**, keeping 307 rows.

   ```
   Nested Loop (rows=33279)
     ->  CTE Scan on today_services ts (rows=70)
     ->  Index Scan on trips t (rows=475 loops=70)
   ->  Index Scan using idx_stop_times_agency_trip_seq on stop_times st (rows=0 loops=33279)
   Execution Time: 155 ms
   ```

   Measured on the full MBTA feed, native PostGIS 16, warm cache (plan 08 investigation).

3. **Simply dropping `MATERIALIZED` gives mixed results.** It returns identical rows, but it's faster at some stops and slower at others, so it isn't a fix on its own:

   | stop                      | current | unmaterialized |
   | ------------------------- | ------- | -------------- |
   | Park Street (7 platforms) | 150 ms  | 19 ms          |
   | bus stop 110              | 117 ms  | 15 ms          |
   | Alewife                   | 131 ms  | 141 ms         |
   | South Station             | 127 ms  | 138 ms         |

## Changes

1. **Migration: `service_dates (agency_id uuid, date date, service_id varchar(100))`.**
   - Primary key `(agency_id, date, service_id)`, FK to agencies, `ON DELETE CASCADE`.
   - It's a real table with statistics, so the planner knows how many services run on a date.
2. **Ingestion: build `stage_service_dates` in staging and swap it with the rest.**
   - Expand every date from `min(start_date)` to `max(end_date)` of `stage_service_calendars`, together with every `stage_service_calendar_dates` date.
   - Apply the weekday flags, remove exception 2, add exception 1. This is the same logic as `activeServicesCte`, moved from request time to load time.
   - MBTA's current feed runs 2026-10-09 to 2026-12-12. The Park Street query found 70 services for today and yesterday together, about 35 per date, so 65 days × 35 is only about **2–3k rows**.
   - `ANALYZE stage_service_dates` with the others.
3. **`activeServicesCte` becomes a lookup:**

   ```sql
   today_services AS (
     SELECT service_id, agency_id, date AS d FROM service_dates
     WHERE agency_id = $2 AND date IN ($3::date, $4::date)
   )
   ```

   - Keep the function's signature, so the three call sites don't change.
   - Leave it unmaterialized, so the planner can use the table's statistics.
   - Keep the old calendar-based SQL in `service-day.spec.ts` as the reference the new table is tested against.

4. **Re-benchmark the four stops above.**
   - If arrivals still walk trips, add the stop-driven index from plan 19, or the denormalized `service_id` on `stop_times` (plan 19, step 3), which lets the filter apply inside the stop index.
   - Target: under 30 ms at all four stops.

## Tests

- **Integration**, using plan 04's fixture semantics:
  - a service removed on a date (exception 2) is absent from `service_dates`;
  - a `calendar_dates`-only service (exception 1) is present;
  - a weekday service is present on weekdays only, within its date range.
- **Equivalence:** for every date in the fixture's range, `SELECT … FROM service_dates` equals the old `activeServicesCte` result.
- **Golden arrivals:** plan 13's golden test returns identical arrivals before and after.

## Verify

`EXPLAIN (ANALYZE)` of arrivals at the four stops, before and after, pasted into the PR. The expected change: no `rows=33279` trip walk at Park Street.
