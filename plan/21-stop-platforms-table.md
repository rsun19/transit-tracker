# Precompute which platforms serve each stop (`stop_platforms`)

**Type:** efficiency (fewer round trips, simpler SQL), plus a new table
**Touches:** new migration, `services/ingestion/src/gtfs-static.service.ts` (derived table in staging), `services/stops/src/stops.service.ts` (`getArrivals`, `batchGetNextArrivals`, `buildAddedEntries`)
**Depends on:** plan 07 (staging), plan 08 (migrations). Independent of 15–20.

## Problem

1. **Every uncached arrivals request resolves "which platforms is this stop?" with 2–4 sequential queries** before the arrivals query runs (`stops.service.ts:277-330`):
   1. `SELECT stop_name, parent_station_id FROM stops …` (`:277`);
   2. then one of:
      - a child platform: its siblings that have service, `stops WHERE parent_station_id = $1 AND EXISTS (SELECT 1 FROM route_stops …)` (`:298`);
      - a parent station: its children that have service, the same query (`:307`);
      - a standalone stop: `SELECT colocated_group_id …`, then `SELECT stop_id … WHERE colocated_group_id = $1` (`:318`), so two more round trips.

   With the agency lookup, Redis, the arrivals query, `loadParentStations` and `buildAddedEntries`, one uncached arrivals call makes **up to 8 sequential round trips**.

2. **The same mapping is rebuilt a second way for nearby.** `batchGetNextArrivals` builds it with an `expanded_stops` CTE (`:777`) that handles parent stations but not colocated groups, so nearby and arrivals can disagree about which platforms a stop includes.
3. **`buildAddedEntries` (`:416`) runs two more queries per request** for ADDED trips: route names, and a `DISTINCT ON (route_id, direction_id)` scan of `trips` for a headsign. `route_branches` already has a headsign per route and direction.
4. **The mapping only changes when the feed does,** yet it's recomputed on every request.

## Changes

1. **Migration: `stop_platforms`**

   | column             | type                 | notes                                                                       |
   | ------------------ | -------------------- | --------------------------------------------------------------------------- |
   | `agency_id`        | `uuid` FK → agencies |                                                                             |
   | `stop_id`          | `varchar(100)`       | any id a user can request: a station, a platform, or a bus stop             |
   | `platform_stop_id` | `varchar(100)`       | a stop with scheduled service that belongs to it                            |
   | `station_id`       | `varchar(100)` NULL  | the parent station, for matching realtime child platforms (`parentOf`)      |
   | `stop_name`        | `text`               | the requested stop's display name, so arrivals needs no separate name query |

   Primary key `(agency_id, stop_id, platform_stop_id)`. About 10k stops × 1–7 platforms, so tens of thousands of rows.

2. **Ingestion:** build `stage_stop_platforms` after `stage_route_stops` and the colocated groups, then swap it in with the rest. Encode today's three rules once, in SQL:
   - **parent station** → its children that appear in `stage_route_stops`;
   - **child platform** → its siblings (same parent) that appear in `stage_route_stops`;
   - **standalone stop** → itself plus its colocated group's members;
   - **otherwise** → itself.
3. **`getArrivals`:** one query, `SELECT platform_stop_id, station_id, stop_name FROM stop_platforms WHERE agency_id = $1 AND stop_id = $2`, replaces `:277-330`.
   - It returns `effectiveStopIds`, `stationIds` and `stopName` together.
   - A stop that isn't in the table is still a 404 / empty result, as today.
4. **`batchGetNextArrivals`:** `expanded_stops` becomes a join on `stop_platforms`, so nearby uses exactly the same mapping as arrivals.
5. **`buildAddedEntries`:** read the headsign from `route_branches` (the longest branch per route and direction) instead of a `DISTINCT ON` over `trips`. It becomes one query joined with `routes`.

## Effect

- An uncached arrivals call goes from up to 8 sequential round trips to 5: agency (gone entirely with plan 16), `stop_platforms`, Redis, the arrivals query, and the parent-station lookup for realtime stops.
- About 40 lines of branching in `getArrivals` become one lookup. Nearby and arrivals can no longer disagree.

## Tests

- **Integration**, with plan 07's fixture extended by a parent station that has two child platforms:
  - requesting the station → both platforms;
  - requesting one platform → both;
  - requesting a colocated pair → both;
  - requesting a lone stop → itself.
- **Golden arrivals** (plan 14) is identical for Park Street (`place-pktrm`), a child platform of it, a colocated bus pair and a lone bus stop.
- `stops.service` unit tests: arrivals makes exactly one stop-resolution query (spy on `dataSource.query`).

## Verify

`pg_stat_statements` (plan 09): the `stops WHERE parent_station_id = …` and `colocated_group_id` queries disappear from the top list, and calls per arrivals request drop. Compare the p50 of uncached arrivals before and after.
