# Make the GTFS static reload atomic and robust

**Type:** reliability and data integrity
**Touches:** `services/ingestion/src/gtfs-static.service.ts`
**Depends on:** PR 04 (adds `service_calendar_dates`, which must be part of the same atomic load), PR 06 (download timeout and cap)

## Problem

1. **`stop_times` and `shapes` are written outside the transaction.** The DELETEs run inside the `queryRunner` transaction (`:128-135`), but `copyStopTimes` takes its *own* client with `pgPool.connect()` (`:552-553`) in autocommit, and `copyShapes` uses `this.dataSource.query` (`:785`). As a result:
   - **During ingestion:** readers see the old stop_times, not yet deleted from their point of view, plus the new ones already committed. `trips.service.ts` returns every stop twice and caches that for 1 h. Arrival queries return duplicates (partly hidden by `DISTINCT ON`).
   - **If any later step fails** (route_stops, branches, colocated groups, OOM, deploy restart): the rollback restores the old rows, and the new stop_times and shapes **stay committed**. Every trip then has doubled stop_times until the next successful run.

   Commit 73f8511 ("delete db bug") only moved `CREATE TABLE` into the transaction; it didn't fix this.
2. **Errors don't propagate.** In the CSV streaming helper (`:366-386`), the async `'end'` handler awaits `batchFn`. If it throws, the outer promise never rejects (an unhandled rejection crashes the worker). The `BATCH_SIZE` branch at `:379-381` does nothing, so whole files are buffered in memory.
3. **Shapes are loaded fully into memory** (`:754-761`) under `--max-old-space-size=300` (`docker-compose.yml:167`). OOM is plausible but unverified for MBTA's shapes.txt.
4. **Missing files are silently skipped** (`:366-369`, `:548`, `:744`). A truncated or bad zip without `stops.txt` or `trips.txt` still commits after the DELETEs, and the site goes empty.
5. **The colocated-group UPDATE wipes earlier batches** (`:715-731`): `CASE … ELSE NULL END WHERE agency_id = $n` touches every stop. MBTA fits in one batch today; larger agencies would break.
6. **COPY escaping is incomplete:** `stop_sequence`, the times and `pickup_type` are written raw (`:628-633`). A malformed feed value containing `,` or a newline can inject rows, including rows for another agency_id.

## Changes

1. **Staging and swap.** COPY every table into `*_staging` tables (`CREATE UNLOGGED TABLE IF NOT EXISTS … (LIKE stop_times INCLUDING DEFAULTS)`) on **the queryRunner's own connection** (`(queryRunner as any).databaseConnection` is a `pg` client and supports `copyFrom`). Validate the counts, then do `DELETE … WHERE agency_id=$1; INSERT … SELECT … FROM staging` in **one short transaction**. For a single-agency deployment, a `ALTER TABLE … RENAME` swap is even faster.
2. Replace the event-handler CSV helper with `for await (const row of stream.pipe(csvParser()))`, real batching, and `await` on every batch. Load shapes with COPY too.
3. **Require** `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, and at least one of `calendar.txt` / `calendar_dates.txt`. Before the swap, abort if any core table's row count is under 50% of the previous load. Log both counts.
4. Colocated groups: `UPDATE stops s SET colocated_group_id = v.gid FROM unnest($1::text[], $2::text[]) v(stop_id, gid) WHERE s.agency_id = $3 AND s.stop_id = v.stop_id`, after one `UPDATE … SET colocated_group_id = NULL WHERE agency_id = $3`.
5. Pass every COPY field through `csvField()`. Validate the GTFS time format with `/^\d{1,3}:\d{2}:\d{2}$/` and integers with `Number.isInteger`; on a bad value, drop the row and count it.
6. Download: stream to disk with the byte cap from PR 06. Check the total uncompressed size from the zip central directory before extracting (a zip-bomb guard).
7. Write `agencies.last_ingested_at` and a `data_version` at the end. PR 09 and PR 12 use them.

## Tests

- Integration test against PostGIS (testcontainers, or the CI service container) with a tiny GTFS fixture:
  - a successful load gives the correct counts and no duplicates;
  - injecting a failure after the stop_times COPY leaves the previous data intact and unduplicated;
  - a zip missing `trips.txt` aborts with the old data intact.
