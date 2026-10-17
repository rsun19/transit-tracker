# Exploratory: store trips as patterns instead of 3M `stop_times` rows

**Type:** exploratory redesign. Decide after 09 and 15–19 have landed and been measured.
**Touches (if pursued):** new tables, the static loader, every query that reads `stop_times` (arrivals, nearby, trip detail, route detail, `route_stops`/`route_branches` builds)
**Depends on:** 15, 17, 18, 19

## Observation

MBTA's schedule is highly repetitive (prod, 2026-10-17):

|                                                                                       | count      |
| ------------------------------------------------------------------------------------- | ---------- |
| trips                                                                                 | 118,284    |
| `stop_times` rows                                                                     | 3,114,168  |
| distinct stop sequences (the ordered list of stops a trip visits)                     | **1,218**  |
| distinct stop sequences + relative timing (offset of each stop from the trip's first) | **10,360** |

So 118k trips are 1.2k _routes through the network_, run on 10k _timetables_, each started at different times. Storing every (trip, stop) pair repeats each timetable about 11 times on average, and each stop list about 100 times.

## Sketch

| table              | rows (MBTA) | contents                                                                                                    |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `stop_patterns`    | 1,218       | `pattern_id`, `agency_id`, `stop_ids text[]` (ordered), `pickup_types`, `drop_off_types`                    |
| `timing_patterns`  | 10,360      | `timing_id`, `pattern_id`, `arrival_offsets int[]`, `departure_offsets int[]` (seconds from the trip start) |
| `trips` (existing) | 118,284     | adds `timing_id` and `start_s` (the first departure, in seconds)                                            |
| `pattern_stops`    | about 30k   | `(agency_id, stop_id) → (pattern_id, position)`: which patterns serve a stop, for arrivals                  |

**Arrivals at a stop:** the patterns serving the stop (`pattern_stops`, a handful of rows) → trips on those patterns active on the service day (`service_dates`, plan 18) → `start_s + offset[position]`, kept if it falls in the time window. With an index on `trips (agency_id, timing_id, start_s)`, that's a range scan per timing pattern instead of a scan over stop_times rows.

**Trip detail and route detail:** unnest the arrays for one trip.

`stop_times` could survive as a view (`unnest` over `trips` ⨝ `timing_patterns` ⨝ `stop_patterns`) for anything that wants rows. Those consumers would be slower, but there are few.

## Expected effect

- About 40k pattern rows plus the 118k trips, instead of 3.1M rows. That's **tens of MB instead of hundreds**, even after plan 19.
- Loads write about 160k rows instead of about 3.3M.

## Why it's exploratory

- **Every `stop_times` query is rewritten, and so are the derived-table builds.** The arrivals SQL becomes array arithmetic, which is harder to read and to `EXPLAIN`.
- **GTFS details need care:**
  - `timepoint` and untimed stops: offsets can be NULL; interpolate, or keep them NULL as now.
  - `frequencies.txt`, which MBTA doesn't use today but other agencies do.
  - Stop-level headsign changes (`stop_headsign`), which vary per trip _and_ stop, so they'd need their own array or a side table.
- **Realtime merging is unaffected** (it's keyed by `trip_id` and `stop_sequence`), but the `stop_sequence` → array position mapping must be exact. GTFS `stop_sequence` values aren't contiguous.
- **It only pays off if storage or load time still matters after 15–19.** Plan 15 makes loads rare, and plan 19 brings `stop_times` to about 0.6 GB. On one agency and this box, that may be enough.

## Decision gate

Pursue this only if, after plans 09 and 15–19, either:

- `stop_times` and its indexes don't fit comfortably in `shared_buffers` (check the hit ratio from plan 09), or
- the project adds agencies, so total `stop_times` grows several times over.

If pursued, start with a read-only prototype: build the pattern tables from a loaded database with SQL, then compare arrivals at the four benchmark stops (plan 18) for equality and latency before touching the loader.
