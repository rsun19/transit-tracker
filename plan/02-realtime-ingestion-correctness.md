# Fix GTFS-RT TripUpdates ingestion (restore what #35 dropped)

**Type:** bug fix, main cause of the MBTA time mismatch
**Touches:** `services/ingestion/src/gtfs-realtime.service.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/agency-config.ts`, `config/agencies.json`, new tests
**Depends on:** nothing (lands first among the timing PRs)

## Problem

The old `backend/` monolith had a full TripUpdates parser. When #35 (`a5e9f84`, "remove legacy backend monolith") moved ingestion into `services/ingestion`, the rewrite lost several behaviors. The current parser (`gtfs-realtime.service.ts:80-170`) has these defects. I checked each one against a live MBTA feed snapshot taken 2026-10-14 ~18:14 ET (`plan/tools-analyze-mbta-feed.py`):

| # | Defect | Code | Live-feed evidence | What the user sees |
|---|--------|------|--------------------|--------------------|
| 1 | `delay` defaults to `0` when the feed omits it. **MBTA never sends `delay`.** | `:115` `stu.arrival?.delay ?? stu.departure?.delay ?? 0` | 0 of 34,931 stop-time updates have a `delay` field | Every realtime row gets an **"On Time"** chip, even when the time shown is 8 minutes behind schedule |
| 2 | Only `arrival.time` is read; `departure.time` is ignored | `:116` | 880 updates are departure-only (mostly the first stop of a trip: terminals, Alewife, Forest Hills, South Station) | At terminals the app shows the **scheduled** time labeled "On Time", while MBTA shows the predicted departure |
| 3 | Skipped stops are stored as `{delay:0}` | no check of `stu.scheduleRelationship` | 1,916 updates are `SKIPPED` (1,910 carry no time at all) | Skipped stops still show a scheduled "On Time" arrival |
| 4 | `CANCELED` trips are ignored | no check of `tripUpdate.trip.scheduleRelationship` | 22 trips canceled in the snapshot | Canceled trips still appear as normal arrivals |
| 5 | `addedTrips` is declared but **never filled** | `:101-110`, written at `:160` | 20 `ADDED` trips; 18 subway trip_ids are not in static GTFS | Extra or unscheduled subway trains never appear; `reconcileAddedTrips.ts` is dead code |
| 6 | Updates are keyed by `stop_id` only | `:111-122` | At terminals and Commuter Rail stations the realtime `stop_id` is a track/platform child (`Alewife-01` vs static `70061`; `NEC-2287-01` vs `NEC-2287`) | Lookups miss at South Station, North Station, and subway terminals, so the schedule is shown |
| 7 | `trip_updates` hash gets `DEL` + N separate `HSET` calls, with **no TTL** | `:152-157` | n/a | (a) For part of every poll the hash is empty or partial, so readers see the schedule and rows flicker. (b) If the feed stops (MBTA outage, worker crash), stale predictions are served **forever** |
| 8 | Alerts are parsed from the TripUpdates feed, which has no alerts | `:125-142` | 0 alert entities in TripUpdates; MBTA publishes `https://cdn.mbta.com/realtime/Alerts.pb` separately | The alert banner never shows anything |

Problems 2, 5 and 7 regressed in #35. The deleted code (viewable with `git show a5e9f84 -- backend/src/modules/ingestion/gtfs-realtime.service.ts`) had a departure fallback, an ADDED-trip collector, and a `pipeline.del/hset/expire` write.

## Changes

1. **New per-stop record shape.** It is written to Redis and read by the stops service:
   ```ts
   type StopRealtime = {
     stopSequence: number | null;
     stopId: string;              // realtime stop_id (may be a child platform)
     arrivalTime: number | null;  // epoch seconds
     departureTime: number | null;
     delay: number | null;        // only when the feed actually sends one
     skipped: boolean;
     uncertainty: number | null;
   };
   type TripRealtime = {
     tripId: string; routeId: string | null; directionId: number | null;
     startDate: string | null;    // YYYYMMDD, from trip descriptor
     canceled: boolean;
     stops: StopRealtime[];       // ordered by stopSequence
     feedTimestamp: number;
   };
   ```
   Store `arrivalTime` and `departureTime` separately; don't merge them into one value. Leave `delay` as `null` when the feed omits it; never default it to `0`.
2. **Trip-level `scheduleRelationship`:**
   - `CANCELED`: write `{canceled: true, stops: []}` so the reader can hide the trip.
   - `ADDED` (or a trip_id not in static `trips`): write to `added_trips:{agency}`, using the same shape plus `routeId` and `directionId`. Load the valid trip_id set from the DB once per static ingestion, not on every poll, and cache it in memory.
3. **Stop-level `SKIPPED`:** keep the entry with `skipped: true`.
4. **Atomic, expiring writes.** Build the full hash in memory. Write it to `trip_updates:{agency}:tmp` in a single `MULTI` with `HSET key {…}` (one call), then `EXPIRE` with a TTL of about 3× the poll interval (≈ 60 s), then `RENAME` over the live key. Do the same for `added_trips`. If the feed comes back empty or fails, let the key expire instead of keeping old data. Bump the key names (`trip_updates:v2:*`) so the old and new readers can't misread each other's format during deploy.
5. **Use `TRIP_UPDATE_CACHE_TTL_S`.** It exists in `constants.ts` but nothing uses it. Change it to `60`.
6. **Alerts.** Add an optional `gtfsRealtimeAlertsUrl` to `agency-config.ts` (zod schema), set it to `https://cdn.mbta.com/realtime/Alerts.pb` in `config/agencies.json`, and parse alerts from that feed only. Pick the English translation (`language === 'en'` or unset), not `translation[0]`. Add `activePeriod` so the alerts service can filter out expired alerts. Store `informedEntity.stopId`, `routeId` and `trip.tripId`. Also fix `alerts.controller.ts:29`, which picks agencies by `hasRealtimePositions` instead of whether they have an alerts feed. The alerts `stopId` filter must also match the parent station or its child platforms; today it requires an exact match.
7. **Stop sending the API key to the CDN.** `cdn.mbta.com` doesn't use it. Today the key goes out as `Authorization: Bearer`, and that header is only meaningful to `api-v3.mbta.com` (where it's `x-api-key`). Make the auth header configurable per agency (`apiKeyHeader`, default none).
8. **Check feed freshness.** Read `feed.header.timestamp`. If it's older than about 120 s, log a warning and don't overwrite fresher data.
9. **Fetch timeout.** Pass `signal: AbortSignal.timeout(10_000)` to both realtime fetches. With no timeout, one stalled connection leaves `isRealtimePollRunning` stuck and freezes realtime data for good (see PR 06 for the rest of the liveness work).
10. **Log a summary** like the legacy code did: `N trip updates, M added, K canceled, S skipped stops`.

## Tests

- Add a fixture: a small `.pb` (or JSON → `FeedMessage.fromObject`) with one trip each for SCHEDULED, CANCELED and ADDED, a departure-only first stop, a SKIPPED stop, a child-platform `stop_id`, and a trip without `delay`.
- Unit-test the parser as a pure function (split `parseTripUpdates(feed, validTripIds)` out of the I/O).
- Unit-test the Redis writer against `ioredis-mock`: after a write the key has a TTL, and there's no window where the key is missing.

## Out of scope

Consuming the new shape in `stops.service.ts` is PR 03. Both PRs must land in the same deploy, or PR 03 must read both formats. Recommendation: merge PR 02 and PR 03 back-to-back, or put them in one PR if review size allows.
