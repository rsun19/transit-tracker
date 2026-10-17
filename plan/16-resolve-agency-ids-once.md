# Resolve agency keys once; filter on `agency_id` everywhere

**Type:** performance (query shape), no schema change
**Touches:** `packages/shared/src/nest/` (new `AgencyDirectory`), `services/routes/src/routes.service.ts`, `trips.service.ts`, `services/stops/src/stops.service.ts`, `services/ingestion/src/static-lookup.service.ts`
**Depends on:** plan 06 (shared Nest module). Independent of the other efficiency plans.

## Problem

Every table is keyed by `agency_id` (a uuid), but callers pass `agencyKey` (`"mbta"`). Several queries filter on `agencies.agency_key` through a join instead of resolving the id first. The planner then puts the one-row `agencies` table on the inner side of a nested loop and scans it once per outer row.

**Evidence** (production `pg_stat_user_tables` / `pg_stat_user_indexes`, 2026-10-17):

- `agencies`: **698,581,260 sequential scans**, for a table with one row.
- `shapes (agency_id, shape_id, pt_sequence)` index: **0 scans**. Meanwhile `shapes` has had 183 sequential scans reading 73M rows.

The culprits:

1. **`routes.service.ts:221-222`, `getShape`**:
   ```ts
   .leftJoin('s.agency', 'a')
   .where('s.shape_id = :shapeId', { shapeId })
   .andWhere('a.agency_key = :agencyKey', { agencyKey })
   ```
   There's no `s.agency_id = …`, so the index (which leads with `agency_id`) is unusable. Every uncached route-shape request scans all 395k points, checking `agencies` per row.
2. **`routes.service.ts:67`, `:110`, `:203`** (`findAll`, `findOne`, `getShape`): `leftJoin('r.agency', 'a')` + `a.agency_key = :agencyKey`. Small table, same pattern.
3. **`static-lookup.service.ts:61`, `:68`**: trips (118k rows) and stops are joined to `agencies` on `agency_key`, once per refresh.
4. **`stops.service.ts:568`, `getRoutesForStop`**: `route_stops JOIN agencies … WHERE a.agency_key = $2`.
5. **Repeated lookups:** `stops.service.ts:270`, `:611` and `trips.service.ts:83` run `SELECT "agencyId", timezone FROM agencies WHERE agency_key = $1` on every uncached arrivals, nearby and trip request. That's one extra round trip each; the `agencies` primary key shows 91M index scans.

## Changes

1. **`AgencyDirectory`** in `packages/shared/src/nest`, an injectable exported by a small module.
   - It holds `agencyKey → { agencyId, timezone, dataVersion }`.
   - It loads all rows at startup (`SELECT "agencyId", agency_key, timezone, data_version FROM agencies`) and refreshes every 60 s, and immediately on a miss, so a newly ingested agency appears.
   - `resolve(key)` returns the entry or `null`; callers turn `null` into their existing 404.
   - `dataVersion` comes along for free for plan 09's cache keys.
2. **Rewrite every site above to take `agencyId`:**
   - `getShape`: `WHERE agency_id = $1 AND shape_id = $2 ORDER BY pt_sequence`, as raw SQL returning `ST_X`/`ST_Y`. That also drops the per-point WKB/regex parsing in `routes.service.ts:228-246`. Plan 17 replaces this query entirely, but this fix stands alone.
   - Routes `findAll` / `findOne`: `r.agency_id = :agencyId`.
   - `static-lookup`: `WHERE t.agency_id = $1`.
   - `getRoutesForStop`: `rs.agency_id = $1 AND rs.stop_id = $2`.
   - The three `SELECT … FROM agencies` round trips are replaced by `directory.resolve()`.
3. **Search with no agency** (`stops.service.ts:132`) keeps the sub-select; it's an InitPlan, evaluated once.

## Tests

- **Unit:** `AgencyDirectory` refresh, miss → reload, unknown key → `null`.
- **Integration:** an `EXPLAIN` of the new `getShape` uses `IDX_6b68907ba5838e74a7080c3341`.
- The existing service specs keep passing, with the constructor injection updated.

## Verify

Record `seq_scan` for `agencies` and `shapes` from `pg_stat_user_tables` before deploy and again a day later. `agencies` should stop climbing in the hundreds of millions, and the shapes index scan count should become non-zero.
