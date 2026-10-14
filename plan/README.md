# Improvement plan: security, reliability, and MBTA time accuracy

This audit was written 2026-10-14 against `origin/main` @ `a5c02fa`. Each numbered file is one PR. Do them in order unless a file's **Depends on** line says otherwise.

## Why app times differ from mbta.com

MBTA's website and its V3 API read the same prediction source (Concentrate) as `TripUpdates.pb`. With correct ingestion, the times should match to the second. They don't, because of a stack of bugs, several introduced when #35 removed the legacy backend. Each one was checked against a live MBTA feed snapshot (`tools-analyze-mbta-feed.py`):

| Cause | Effect | Fixed in |
|---|---|---|
| MBTA never sends `delay` (0 of 34,931 updates), and the app defaults it to 0 | Every realtime row says **"On Time"** | 02, 03, 05 |
| Only `arrival.time` is read; 880 updates are departure-only | Terminals (Alewife, Forest Hills, South Station, …) show the **schedule** | 02, 03 |
| Realtime is matched by `stop_id`, and the realtime stop_id is a track/platform child (`Alewife-01`, `NEC-2287-01`) | Predictions missed at terminals and Commuter Rail stations | 02, 03 |
| Arrivals are kept only if the *scheduled* time is ≥ now − 10 min | Vehicles more than 10 min late **disappear** (2,598 such predictions in the snapshot) | 03 |
| CANCELED trips (22) and SKIPPED stops (1,916) are ignored | Canceled or skipped service is still listed | 02, 03 |
| ADDED trips are never written (`addedTrips` is never filled) | Extra subway trains never shown | 02, 03 |
| `trip_updates` is written as DEL + N separate HSETs with no TTL | Rows flicker back to the schedule every poll; if the feed dies, stale predictions are served **forever** | 02 |
| `calendar_dates.txt` is not ingested (98 removals and 45 additions in the current feed) | Wrong trip set on holidays and special days (next: Oct 16–19, Nov 1, **Nov 11**) | 04 |
| Service-day math uses local midnight, not "noon − 12h"; `trips.service` uses UTC `CURRENT_DATE` | ±1 h on DST days (next: **Nov 1**); trip detail shifted a day after 8 pm ET | 04 |
| Times formatted in the browser's timezone; clock time instead of MBTA's "N min" | Off by hours for non-Eastern devices; ±1 min rounding "mismatches" | 05 |
| 15 s worker poll + 15 s API cache + 15 s frontend poll | Up to about 45 s stale | 03, 05 |
| Alerts are parsed from the TripUpdates feed, which has none | The alert banner never shows | 02 |

## PR sequence

| # | Plan | Type | Size |
|---|------|------|------|
| 01 | [Edge hardening: close the port-80 API bypass, security headers](01-edge-hardening-nginx.md) | security | S |
| 02 | [GTFS-RT TripUpdates ingestion correctness](02-realtime-ingestion-correctness.md) | **time accuracy** | M |
| 03 | [Realtime merge and filtering in the stops service](03-arrivals-merge-and-filtering.md) | **time accuracy** | M |
| 04 | [`calendar_dates.txt` and service-day time math](04-service-calendar-dates-and-service-day.md) | **time accuracy** | M |
| 05 | [Frontend arrival display (timezone, past rows, countdown)](05-frontend-arrival-display.md) | **time accuracy** / UX | S–M |
| 06 | [Shared infra module plus Redis and worker resilience](06-shared-infra-and-resilience.md) | reliability | M |
| 07 | [Atomic GTFS static reload](07-atomic-static-ingestion.md) | data integrity | M–L |
| 08 | [Migrations instead of `synchronize: true`; indexes](08-schema-migrations-and-indexes.md) | reliability / perf | M |
| 09 | [API validation and cache-key correctness](09-api-validation-and-cache-keys.md) | security (DoS) | M |
| 10 | [Dependency, runtime, and container upgrades](10-dependency-and-container-upgrades.md) | security | L (split into a/b/c) |
| 11 | [CI and deploy workflow hardening](11-ci-hardening.md) | security (supply chain) | S |
| 12 | [Functional fixes (vehicle payload, `lastIngestedAt`) and dead code](12-functional-fixes-and-cleanup.md) | bugs / cleanup | S |
| 13 | [Test coverage where the risk is](13-test-coverage.md) | tests | M |

PRs 02 and 03 change the Redis format together, so merge and deploy them back-to-back (or as one PR). PRs 04, 11 and 01 can be done in parallel with anything.

## Security summary

**No SQL injection found:** every raw query is parameterized. **No committed secrets:** only `.env.example` is tracked. **No XSS sinks.** **No API key in the client bundle.**

The main risks, in priority order:

1. **Public port 80 proxies the whole API with no rate limit** (01).
2. **Out-of-support Next 14 and Node 20**, with known DoS advisories (10).
3. **Redis clients stop reconnecting for good after about 1.5 s** (06).
4. **Unbounded, user-keyed cache entries and no Redis `maxmemory`** (09, 06).
5. **Every service connects as the Postgres superuser and gets every secret** (10).
6. **CI deploy actions are tag-pinned and do no SSH host-key check** (11).
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
