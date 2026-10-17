# Build route detail once per load (`route_documents`)

**Type:** efficiency (fewer queries, no heavy fallback), plus a new table
**Touches:** new migration, `services/ingestion/src/gtfs-static.service.ts` (derived table in staging), `services/routes/src/routes.service.ts` (`findOne`, `getShape`)
**Depends on:** plans 07, 08. Easier after 17 (`shape_lines`) and 16 (agency ids).

## Problem

Route detail is static between loads, but every uncached request rebuilds it from the base tables.

1. **`findOne` (`routes.service.ts:103-197`) makes up to 5 queries:**
   1. the route (TypeORM, joined to `agencies` on `agency_key`; plan 16);
   2. `route_branches` for the route;
   3. **a fallback when `route_branches` is empty (`:135`):** `trips ⨝ stop_times` grouped per trip with `COUNT(st.stop_id)` and `DISTINCT ON`. That's an aggregation over every `stop_times` row of the route's trips, tens of thousands of rows for a bus route. Since plan 07, `route_branches` is always built in the same transaction as `stop_times`, so the fallback is dead weight;
   4. `stop_times ⨝ stops` with `DISTINCT ON (trip_id, stop_sequence)` for the branch trips (`:161`);
   5. then the response is assembled in JavaScript: grouping, sorting, labels.
2. **`getShape` (`:200`) repeats the route lookup and the `route_branches` query** before reading the shape (395k-row `shapes`, plan 17).
3. **Both are cached for `API_CACHE_ROUTES_TTL_S` (1 h).** Every deploy, cache eviction or new route id rebuilds them, and the cache keys don't follow the data (plan 10).

## Changes

1. **Migration: `route_documents`**

   | column      | type                 | notes                                                                                          |
   | ----------- | -------------------- | ---------------------------------------------------------------------------------------------- |
   | `agency_id` | `uuid` FK → agencies |                                                                                                |
   | `route_id`  | `varchar(100)`       |                                                                                                |
   | `detail`    | `jsonb`              | the `findOne` response: route fields, `stops`, `branches[]` with ordered stops and coordinates |
   | `shape`     | `jsonb` NULL         | the `getShape` response: a GeoJSON LineString of the longest branch's shape                    |

   Primary key `(agency_id, route_id)`. About 400 rows for MBTA.

2. **Ingestion:** build `stage_route_documents` in staging after `stage_route_branches` (and `stage_shape_lines` if plan 17 has landed), then swap it with the rest.
   - Build it in SQL with `jsonb_build_object` / `jsonb_agg (… ORDER BY stop_sequence)` over the staged `route_branches ⨝ stop_times ⨝ stops`. That's the same joins the service runs today, once per load instead of once per request.
   - `shape` comes from `ST_AsGeoJSON(ST_MakeLine(location ORDER BY pt_sequence))::jsonb` over `stage_shapes` (or `stage_shape_lines.geom`).
   - Keep the exact response field names and order. The tests below compare against today's output.
3. **`findOne` / `getShape`:** `SELECT detail` / `SELECT shape FROM route_documents WHERE agency_id = $1 AND route_id = $2` → 404 when missing.
   - Delete the fallback aggregation and the JavaScript assembly.
   - Keep the Redis cache (it saves a DB round trip), keyed on `data_version` (plan 10).
4. **`findAll`** (the route list) stays a query over `routes`. It's small, and it filters and sorts.

## Effect

- Route detail: from up to 5 queries plus JavaScript assembly to **1 primary-key lookup**.
- Route shape: from 3 queries plus a 395k-row scan (plan 16) to **1**.
- The dead fallback query over `stop_times` is removed.
- Load cost: about 400 JSON documents, built from tables already in staging (seconds).

## Tests

- **Parity:** for every MBTA route, today's `findOne` / `getShape` output deep-equals the stored `detail` / `shape`. Run it once against a loaded database before switching the service, as a one-off script, in the same spirit as plan 07's parity check.
- **Integration** (plan 07's fixture): R1 has two branches (`Elm St` and `Main St`) with stops in sequence order; R2's shape is NULL (its trips have no `shape_id`); an unknown route → 404.

## Verify

`pg_stat_statements` (plan 09): the `DISTINCT ON (st.trip_id, st.stop_sequence)` and `route_branches` queries leave the top list. Time a route page with the Redis cache cleared, before and after.
