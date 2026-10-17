# Store each shape as one LineString

**Type:** efficiency, plus a new table
**Touches:** new migration (`shape_lines`), `services/ingestion/src/gtfs-static.service.ts` (derived table in staging), `services/routes/src/routes.service.ts` (`getShape`), `packages/shared/src/entities/shape.entity.ts`
**Depends on:** plan 07 (staging), plan 08 (migrations). Do after plan 16, or fold 16's `getShape` change into this one.

## Problem

1. **`shapes` stores one row per point: 395,535 rows, 204 MB** (116 MB of it indexes) (prod, 2026-10-17).
   - Each row carries a uuid primary key, the agency uuid, the `shape_id` string, a sequence number and a PostGIS point. About 100 bytes of overhead per point.
2. **There's only one reader: `getShape` (`routes.service.ts:200-249`).**
   - It loads every point of one shape as TypeORM entities and then parses each point back out of WKB, with a regex fallback.
   - The result is a GeoJSON LineString, cached for 300 s.
3. **Most of it is never served.** Only 889 of the 1,152 shapes appear in `route_branches`, and `getShape` only ever serves the longest branch per route.
4. **Every reload deletes and re-inserts all 395k points** (plan 15 reduces how often, not the size).

## Changes

1. **Migration: `shape_lines`**

   | column        | type                                      |
   | ------------- | ----------------------------------------- |
   | `agency_id`   | `uuid` FK → agencies, `ON DELETE CASCADE` |
   | `shape_id`    | `varchar(100)`                            |
   | `geom`        | `geometry(LineString, 4326)`              |
   | `point_count` | `int`                                     |
   | `length_m`    | `real`, `ST_Length(geom::geography)`      |

   Primary key `(agency_id, shape_id)`. No spatial index until something queries by area.

2. **Ingestion:** after `stage_shapes` is loaded, build `stage_shape_lines` in staging and swap it with the others:
   ```sql
   INSERT INTO stage_shape_lines (agency_id, shape_id, geom, point_count, length_m)
   SELECT $1, shape_id, ST_MakeLine(location ORDER BY pt_sequence), count(*),
          ST_Length(ST_MakeLine(location ORDER BY pt_sequence)::geography)
   FROM stage_shapes GROUP BY shape_id HAVING count(*) >= 2
   ```
   `stage_shapes` becomes staging-only: it's still loaded with `COPY` and dropped with the other temp tables, but it's **no longer swapped into a live table**.
3. **`getShape`:** `SELECT ST_AsGeoJSON(geom)::json AS geometry FROM shape_lines WHERE agency_id = $1 AND shape_id = $2`.
   - That's one row, with no per-point parsing.
   - If map payloads matter, add an optional `ST_Simplify(geom, 0.00001)` (about 1 m) variant, kept in a second column so it costs nothing at read time.
4. **Retire `shapes`,** in the release after `shape_lines` is serving: a migration drops it, and the `Shape` entity is deleted. Two steps, so a rollback to the previous release still has its table.

## Size

- **Before:** 395k rows, 204 MB.
- **After:** 1,152 rows. 395k points × 16 bytes of coordinates is about 6 MB, plus row headers. That's roughly **30× smaller**, and the load writes 1,152 rows instead of 395k.

## Tests

- **Integration:** the fixture feed's `SH1` loads as a 2-point LineString with `point_count = 2` (the invalid point is dropped, as in plan 07).
- **Parity:** for every MBTA `shape_id` in `route_branches`, `getShape` returns the same coordinates before and after. Run it once against a loaded database; it's too slow for CI.

## Verify

`pg_total_relation_size('shape_lines')` against the old `shapes` size. Time a route-shape request with the cache cleared, before and after.
