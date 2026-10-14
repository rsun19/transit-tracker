# Replace `synchronize: true` with migrations; fix query/index mismatches

**Type:** reliability and performance
**Touches:** `services/ingestion/src/worker.module.ts`, new `packages/shared/src/migrations/`, `gtfs-static.service.ts` (remove ad-hoc DDL), `stops.service.ts` queries, `docker/init-db.sql`
**Depends on:** PR 07 (staging tables are created by migration)

## Problem

1. **`synchronize: true` in production** (`worker.module.ts:42`). TypeORM's `dropOldIndices` drops every index on an entity table that isn't declared in the entity metadata, and that includes GIN indexes. So `idx_stops_stop_name_trgm` and `idx_stops_stop_code_trgm` (created ad hoc at `gtfs-static.service.ts:172-189`) are **dropped on every worker start**, and come back only at the next 4 am ingestion, because `GTFS_INGEST_ON_STARTUP=false`. Stop search does sequential scans for most of the day after each deploy. The bigger danger: a future entity rename makes `synchronize` drop a column, data included, in production.
2. **Ad-hoc DDL** for `route_stops` and `route_branches` (`gtfs-static.service.ts:95-124`) runs on every ingestion.
3. **Geography casts block the index.** Nearby search casts `s.location::geography` inside `ST_DWithin` and `<->` (`stops.service.ts:548-554`), but the GIST index is on geometry (`stop.entity.ts:42`). Every nearby request scans all ~10k stops and computes `ST_Distance` for each.
4. **`route_stops` lookups filter on `stop_id = ANY($1)` without `agency_id`** (`stops.service.ts:104,579`). The indexes lead with `agency_id`, so they can't be used efficiently.
5. **`parent_station_id` has no index**, but it's queried at `stops.service.ts:216-228,707-708`.
6. **`stop_times` index is on `departure_time`** (`stop-time.entity.ts:6`), but the queries filter and sort on `arrival_time` wrapped in an expression, so the index only helps through its `(agency_id, stop_id)` prefix. That's fine, but after PR 03 switches to departure semantics, keep the index and query consistent.

## Changes

1. Add a TypeORM `migrations` folder and run migrations from the worker on boot (`migrationsRun: true`), with an advisory lock so only the worker migrates. Set `synchronize: false` everywhere.
2. Baseline migration: the current schema as it exists in prod (generate it from a prod-like DB), plus:
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm`, then the trigram indexes (instead of ad-hoc DDL);
   - the `route_stops` and `route_branches` tables, with an index on `(stop_id, agency_id)`;
   - `CREATE INDEX ON stops (agency_id, parent_station_id)`;
   - `CREATE INDEX ON stops USING gist ((location::geography))`, *or* change the column type to `geography(Point,4326)`;
   - the `service_calendar_dates` table from PR 04 and the staging tables from PR 07.
3. Delete the DDL from `gtfs-static.service.ts`; ingestion only does DML.
4. Rewrite the nearby query to compare against the indexed expression exactly. Add `agency_id` to the `route_stops` filters.
5. `EXPLAIN ANALYZE` before and after for: nearby, stop search, and arrivals at Park Street. Paste the plans into the PR description.

## Rollout

The first deploy runs the baseline migration against an existing DB. Write it idempotently (`IF NOT EXISTS`), or mark it as already run with `INSERT INTO migrations`, so it doesn't fail on tables that exist. Take a DB snapshot first (`pg_dump`).
