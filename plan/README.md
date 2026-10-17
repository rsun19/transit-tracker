# Improvement plan: security, reliability, and MBTA time accuracy

This audit was written 2026-10-14 against `origin/main` @ `a5c02fa`. Each numbered file is one PR. Do them in order unless a file's **Depends on** line says otherwise.

## Why app times differ from mbta.com

MBTA's website and its V3 API read the same prediction source (Concentrate) as `TripUpdates.pb`. With correct ingestion, the times should match to the second. They don't, because of a stack of bugs, several introduced when #35 removed the legacy backend. Each one was checked against a live MBTA feed snapshot (`tools-analyze-mbta-feed.py`):

| Cause                                                                                                              | Effect                                                                                                   | Fixed in   |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------- |
| A missing `delay` is treated as 0, and MBTA sent none in the snapshot (0 of 34,931 updates)                        | Every realtime row says **"On Time"**                                                                    | 02, 03, 05 |
| Only `arrival.time` is read; 880 updates are departure-only                                                        | Terminals (Alewife, Forest Hills, South Station, …) show the **schedule**                                | 02, 03     |
| Realtime is matched by `stop_id`, and the realtime stop_id is a track/platform child (`Alewife-01`, `NEC-2287-01`) | Predictions missed at terminals and Commuter Rail stations                                               | 02, 03     |
| Arrivals are kept only if the _scheduled_ time is ≥ now − 10 min                                                   | Vehicles more than 10 min late **disappear** (2,598 such predictions in the snapshot)                    | 03         |
| CANCELED trips (22) and SKIPPED stops (1,916) are ignored                                                          | Canceled or skipped service is still listed                                                              | 02, 03     |
| ADDED trips are never written (`addedTrips` is never filled)                                                       | Extra subway trains never shown                                                                          | 02, 03     |
| `trip_updates` is written as DEL + N separate HSETs with no TTL                                                    | Rows flicker back to the schedule every poll; if the feed dies, stale predictions are served **forever** | 02         |
| `calendar_dates.txt` is not ingested (98 removals and 45 additions in the current feed)                            | Wrong trip set on holidays and special days (next: Oct 16–19, Nov 1, **Nov 11**)                         | 04         |
| Service-day math uses local midnight, not "noon − 12h"; `trips.service` uses UTC `CURRENT_DATE`                    | ±1 h on DST days (next: **Nov 1**); trip detail shifted a day after 8 pm ET                              | 04         |
| Times formatted in the browser's timezone; clock time instead of MBTA's "N min"                                    | Off by hours for non-Eastern devices; ±1 min rounding "mismatches"                                       | 05         |
| 15 s worker poll + 15 s API cache + 15 s frontend poll                                                             | Up to about 45 s stale                                                                                   | 03, 05     |
| Alerts are parsed from the TripUpdates feed, which has none                                                        | The alert banner never shows                                                                             | 02         |

## PR sequence

| #   | Plan                                                                                                     | Type                    | Size                 |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------- |
| 01  | [Edge hardening: close the port-80 API bypass, security headers](01-edge-hardening-nginx.md)             | security                | S                    |
| 02  | [GTFS-RT TripUpdates ingestion correctness](02-realtime-ingestion-correctness.md)                        | **time accuracy**       | M                    |
| 03  | [Realtime merge and filtering in the stops service](03-arrivals-merge-and-filtering.md)                  | **time accuracy**       | M                    |
| 04  | [`calendar_dates.txt` and service-day time math](04-service-calendar-dates-and-service-day.md)           | **time accuracy**       | M                    |
| 05  | [Frontend arrival display (timezone, past rows, countdown)](05-frontend-arrival-display.md)              | **time accuracy** / UX  | S–M                  |
| 06  | [Shared infra module plus Redis and worker resilience](06-shared-infra-and-resilience.md)                | reliability             | M                    |
| 07  | [Atomic GTFS static reload](07-atomic-static-ingestion.md)                                               | data integrity          | M–L                  |
| 08  | [Migrations instead of `synchronize: true`; indexes](08-schema-migrations-and-indexes.md)                | reliability / perf      | M                    |
| 09  | [Size Postgres for the box; reclaim bloat; `pg_stat_statements`](09-postgres-memory-and-bloat.md)        | performance (config)    | S                    |
| 10  | [API validation and cache-key correctness](10-api-validation-and-cache-keys.md)                          | security (DoS)          | M                    |
| 11  | [Dependency, runtime, and container upgrades](11-dependency-and-container-upgrades.md)                   | security                | L (split into a/b/c) |
| 12  | [CI and deploy workflow hardening](12-ci-hardening.md)                                                   | security (supply chain) | S                    |
| 13  | [Functional fixes (vehicle payload, `lastIngestedAt`) and dead code](13-functional-fixes-and-cleanup.md) | bugs / cleanup          | S                    |
| 14  | [Test coverage where the risk is](14-test-coverage.md)                                                   | tests                   | M                    |

PRs 02 and 03 change the Redis format together, so merge and deploy them back-to-back (or as one PR). PRs 04, 12 and 01 can be done in parallel with anything.

## Database efficiency (09, 15–20)

Added 2026-10-17 after plans 01–08 landed, from production's `pg_stat_user_tables` / `pg_stat_user_indexes` and a full MBTA load on PostGIS 16. The database is about 3 GB, and `stop_times` is 2.7 GB of it. Most of the cost is overhead, not data:

| Finding (prod)                                                                                                                                                                 | Plan             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `shared_buffers` is 32 MB on a 3.8 GB box; `max_wal_size` is 64 MB, so a load checkpoints constantly (the production swap takes 257 s; locally, 25 s)                          | 09               |
| `stop_times` heap is 268 B per live row for 124 B rows (2.2× bloat from about 170 full reloads); `pg_stat_statements` isn't installed                                          | 09               |
| Every deploy and the nightly cron rewrite 3.1M `stop_times` rows even when MBTA hasn't published; MBTA answers `If-None-Match` with 304                                        | 15               |
| `agencies` (1 row) has had **698M sequential scans**: queries filter on `agency_key` through a join. The shapes index has **0 scans**: `getShape` never filters on `agency_id` | 16               |
| `shapes` is 395k point rows (204 MB), read only to rebuild about 900 LineStrings                                                                                               | 17               |
| Arrivals at Park Street take about 150 ms: the per-request service-day CTE has no statistics, so the planner walks 33k trips                                                   | 18               |
| `stop_times` indexes are 1.9 GB: an unused 506 MB uuid primary key, and an 889 MB index on a 16-byte `interval`                                                                | 19               |
| 118k trips are 1,218 stop sequences on 10,360 timetables                                                                                                                       | 20 (exploratory) |

| #   | Plan                                                                                              | Type                   | Size |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------- | ---- |
| 15  | [Skip unchanged static feeds; `gtfs_feed_loads` history table](15-skip-unchanged-static-feeds.md) | efficiency, new table  | M    |
| 16  | [Resolve agency keys once; filter on `agency_id`](16-resolve-agency-ids-once.md)                  | query shape            | S    |
| 17  | [One LineString per shape (`shape_lines`)](17-shape-linestrings.md)                               | efficiency, new table  | S–M  |
| 18  | [Precomputed `service_dates`](18-service-dates-table.md)                                          | performance, new table | M    |
| 19  | [Compact `stop_times`: natural key, integer times, stop-first index](19-compact-stop-times.md)    | storage, schema change | L    |
| 20  | [Trips as patterns instead of `stop_times` rows](20-trip-pattern-storage.md)                      | exploratory            | XL   |

**Order:**

- 09 comes first, in the main sequence above: it's cheap, and its `pg_stat_statements` baseline measures the rest.
- 15 and 16 next; they're independent of each other.
- 17 and 18 can follow in any order.
- 19 after 18, because 18's benchmark decides whether 19 also denormalizes `service_id`.
- 20 only if the decision gate in its file is met.

Plans 15, 17 and 18 add derived or bookkeeping tables, built in plan 07's staging step and swapped atomically with the rest.

## Security summary

**No SQL injection found:** every raw query is parameterized. **No committed secrets:** only `.env.example` is tracked. **No XSS sinks.** **No API key in the client bundle.**

The main risks, in priority order:

1. **Public port 80 proxies the whole API with no rate limit** (01).
2. **Out-of-support Next 14 and Node 20**, with known DoS advisories (11).
3. **Redis clients stop reconnecting for good after about 1.5 s** (06).
4. **Unbounded, user-keyed cache entries and no Redis `maxmemory`** (10, 06).
5. **Every service connects as the Postgres superuser and gets every secret** (11).
6. **CI deploy actions are tag-pinned and do no SSH host-key check** (12).
7. **Non-atomic static reload** that can leave duplicated `stop_times` (07).

## Re-running the feed analysis

```sh
D=$(mktemp -d)
curl -sS -o $D/tu.json https://cdn.mbta.com/realtime/TripUpdates_enhanced.json
curl -sS -o $D/gtfs.zip https://cdn.mbta.com/MBTA_GTFS.zip
unzip -q $D/gtfs.zip calendar.txt calendar_dates.txt trips.txt stop_times.txt stops.txt -d $D/gtfs
python3 -I plan/tools-analyze-mbta-feed.py $D
```

It needs only the standard library (Python ≥ 3.9 for `zoneinfo`). After PRs 02 and 03, also spot-check the app's `/api/v1/stops/<id>/arrivals` against `https://api-v3.mbta.com/predictions?filter[stop]=<id>`.
