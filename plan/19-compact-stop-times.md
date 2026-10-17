# Compact `stop_times`: natural key, integer times, a stop-first index

**Type:** efficiency (storage and I/O), schema change
**Touches:** new migration, `packages/shared/src/entities/stop-time.entity.ts`, `packages/shared/src/service-day.ts` (`gtfsTimestampSql`), `services/ingestion/src/static/gtfs-rows.ts` (`STOP_TIMES`), `gtfs-static.service.ts`, the `stop_times` queries in `services/stops/src/stops.service.ts`, `services/routes/src/{routes,trips}.service.ts`
**Depends on:** plans 07, 08, 14 (for measuring), 18 (so the arrivals benchmark is meaningful)

## Problem

`stop_times` is most of the database, and most of it is overhead (prod, 2026-10-17):

|                                                                          | size       | notes                                                                              |
| ------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------- |
| heap                                                                     | 797 MB     | 3,114,168 rows. Average row 124 B, but 268 B of heap per live row (bloat, plan 14) |
| `PK_1a2a89e5…` (uuid `id`)                                               | **506 MB** | never used to find a row; its only scans are uniqueness checks on insert           |
| `idx_stop_times_agency_stop_dept` (`agency_id, stop_id, departure_time`) | **889 MB** | 28k scans; `departure_time` is a 16-byte `interval`                                |
| `idx_stop_times_agency_trip_seq` (`agency_id, trip_id, stop_sequence`)   | 508 MB     | 2.4M scans; this is the table's natural key                                        |
| **total**                                                                | **2.7 GB** |                                                                                    |

Per row:

- `id uuid`: 16 B, unused.
- `agency_id uuid`: 16 B.
- `trip_id` and `stop_id` as varchar: about 12 B and 7 B.
- **two `interval`s: 16 B each.** GTFS times fit in a 4-byte integer number of seconds.

## Changes

1. **Natural primary key.**
   - Drop `id`, and make `(agency_id, trip_id, stop_sequence)` the primary key. It replaces `idx_stop_times_agency_trip_seq`, which has the same columns.
   - The entity uses three `@PrimaryColumn`s instead of `@PrimaryGeneratedColumn('uuid')`.
2. **Integer times.** Replace `arrival_time`/`departure_time interval` with `arrival_s int` / `departure_s int`: seconds after the service day's noon-minus-12h, so `25:30:00` is `91800`.
   - `gtfsTimestampSql(date, time, tz)` takes the seconds column and adds `make_interval(secs => …)`. The callers keep their shape.
   - The loader parses `H:MM:SS` to seconds in `gtfs-rows.ts`; it already validates the format.
   - Responses that currently expose `interval` text derive it from seconds where needed. Today nothing returns raw intervals; check `trips.service.ts`.
3. **Stop-first index, sized for the arrivals query.**
   - `(agency_id, stop_id, departure_s) INCLUDE (trip_id, stop_sequence, arrival_s, pickup_type)`. Arrivals then become an index-only range scan per platform, and the join to `trips` uses its primary key.
   - **Decide after plan 18:** if arrivals still walk trips, also denormalize `service_id` onto `stop_times`, and make the index `(agency_id, stop_id, service_id, departure_s)` so today's services filter inside the index. It's 4–10 B per row, written by the loader from `stage_trips`.
4. **Rolling out the table rewrite.** The migration builds the new layout alongside the old:
   - `CREATE TABLE stop_times_v2 (…)`, then `INSERT … SELECT` converting the intervals with `extract(epoch from …)::int`, then build the indexes.
   - In one transaction, `DROP TABLE stop_times` and `ALTER TABLE stop_times_v2 RENAME TO stop_times`.
   - On production that's about 3M rows; expect a few minutes at plan 14's settings. Readers keep the old table until the rename commits.
   - The `migrate` service runs before the new services start (plan 08), so old code never sees the new layout.
   - Take a `pg_dump` first, as for plan 08.

   The rename is done by the migration's schema-owner role, so plan 10's least-privilege ingest role isn't affected. That's why this is a migration and not part of the load.

5. **Shapes:** if plan 17 hasn't landed yet, drop `shapes.id` the same way; its uuid primary key is 59 MB.

**Not in this plan:** integer surrogate keys for `trip_id`/`stop_id`. That would save about 12 B more per row, but every query and API boundary would have to translate ids. Plan 20 is the bigger version of that idea.

## Expected size (estimate; measure on a copy first)

|                                                   | rows                 | estimate                               |
| ------------------------------------------------- | -------------------- | -------------------------------------- |
| heap                                              | 3.1M × about 70–80 B | about 230 MB                           |
| primary key `(agency_id, trip_id, stop_sequence)` |                      | about 150 MB                           |
| stop index, with its `INCLUDE` columns            |                      | about 200 MB                           |
| **total**                                         |                      | **about 0.6 GB, against 2.7 GB today** |

Each reload writes proportionally less (rarely, after plan 15), and the working set fits in plan 14's `shared_buffers`.

## Tests

- **Migration integration** (plan 08's harness): adopt the old layout with rows, migrate, and check every row converted. Spot-check `25:30:00` → `91800` and NULL times staying NULL. The entity-drift test passes.
- **Golden arrivals** (plan 13) and the plan 07 fixture load are identical before and after.
- `gtfsTimestampSql` unit tests are updated for seconds, including the DST cases from plan 04.

## Verify

- `pg_total_relation_size('stop_times')` and each index's size, before and after.
- `EXPLAIN (ANALYZE)` of arrivals at Park Street, Alewife, South Station and a bus stop, against plan 18's numbers.
- Load time from the ingestion log.
