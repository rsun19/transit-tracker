# Fix how the stops service merges realtime into arrivals

**Type:** bug fix, second half of the MBTA time mismatch
**Touches:** `services/stops/src/stops.service.ts`, `stops.types.ts`, `reconcileAddedTrips.ts`, specs
**Depends on:** PR 02 (reads the new `TripRealtime` shape)

## Problem

These are in `StopsService.getArrivals` (`stops.service.ts:173-450`) and `batchGetNextArrivals` (`:668-765`).

1. **Late vehicles vanish.** The SQL keeps a row only if its *scheduled* time is ≥ `now − 10 min` (`:259-266`, `:298`). A bus 15 minutes late gets dropped 10 minutes after its scheduled time, while MBTA still shows it as coming. In the live snapshot, 2,598 stop predictions (2,154 bus, 443 subway) were more than 10 minutes behind schedule. `LIMIT` is also applied in *scheduled* order before the realtime re-sort, so a late trip can be cut off by the limit.
2. **Realtime lookup misses.** It uses `tripRealtime[row.stop_id]` (`:343`). The realtime `stop_id` differs from the static one at terminals and Commuter Rail tracks (see PR 02 #6). The query doesn't select `stop_sequence`, so there's nothing better to match on.
3. **Fake "On Time".** `realtimeDelaySeconds` is copied from the feed's `delay`, which MBTA never sends; PR 02 makes it `null`. Delay must be computed as `predicted − scheduled`.
4. **The sort counts delay twice.** `:441-445` sorts on `realtimeArrival + realtimeDelaySeconds`, but `realtimeArrival` is already the predicted absolute time. `getNearbyStops` does the same at `:647-652`.
5. **Nearby shows `NaN` delay.** `batchGetNextArrivals` does `parseInt(val, 10)` on a JSON object string (`:742`). That yields `NaN`, and `hasRealtime: delay !== null` then sets `hasRealtime: true`. The nearby API's `nextArrival` never uses the actual prediction and carries a garbage delay. The frontend doesn't render `nextArrival` yet (`api-client.ts:76` only types it), so today the bug is visible only through the API, but it will surface as soon as the nearby page starts showing it. It also filters on scheduled time `>= NOW()`, so a late vehicle still coming doesn't count as "next".
6. **Canceled and skipped stops aren't hidden** (needs PR 02).
7. **The arrival-vs-departure difference is ignored.** MBTA's site shows *departure* predictions for boarding (and always for Commuter Rail). The app shows arrival only, and at a terminal (no arrival prediction) it falls back to schedule. Pick the time the rider cares about: `departure ?? arrival` for boarding, and hide rows where `pickup_type = 1` (no pickup; e.g. the arrival-only last stop of a trip, which MBTA doesn't show as a departure).
8. **Stale data on every page load.** Responses are cached for 15 s (`API_CACHE_ARRIVALS_TTL_S`) on top of the 15 s worker poll and the 15 s frontend poll, so a prediction can be about 45 s old by the time it's on screen. Realtime ETAs need a shorter cache: 5 s, or cache only the static schedule part and merge realtime per request. Redis `HMGET` is cheap.

## Changes

1. **SQL:** also select `st.stop_sequence`, `st.departure_time`, and `st.pickup_type`. Widen the schedule window to `now − 90 min` (make it a config constant) so late trips stay in. Drop the scheduled-order `LIMIT`, or set it to about 3× the requested limit, and apply the real limit *after* the realtime merge and filter.
2. **Matching:** match each static row to a realtime stop by `stop_sequence` first. Fall back to `stop_id`, then to the realtime stop's parent station. If PR 02 starts storing `startDate`, use it to tell apart the same trip_id on yesterday's and today's service day (the CTE already expands both days).
3. **Fields:** compute `predictedTime = departureTime ?? arrivalTime` (boarding semantics), `scheduledTime`, and `delaySeconds = predicted − scheduled`, and set `hasRealtime` only when a prediction actually exists.
4. **Filtering:** drop canceled trips and skipped stops. Drop rows whose *effective* time (prediction if present, otherwise schedule) is more than 30 s in the past. Then sort by effective time and apply the limit.
5. **Response shape.** Keep `realtimeArrival` for compatibility, and add `scheduledTime`, `predictedTime | null`, `status: 'scheduled'|'on_time'|'late'|'early'|'canceled'|'skipped'`, and `uncertaintySeconds`. This lets the frontend (PR 05) stop deriving status itself. Keep the delay thresholds in one place, on the server.
6. **ADDED trips:** keep `reconcileAddedTrips`, but make it consume the PR 02 `added_trips` shape. Matching an ADDED trip to an unpredicted *scheduled* trip within ±5 min (`reconcileAddedTrips.ts:1`) can wrongly hide a real scheduled trip on frequent routes. Restrict that matching to subway, where MBTA does replace scheduled trips with ADDED ones, and add it to the specs.
7. **`batchGetNextArrivals`:** replace it with the same merge logic. Extract `mergeRealtime(rows, realtimeByTrip)` as a pure function used by both paths, and fix the `parseInt` bug as part of that.
8. Fix the double-counting in both sorts.
9. Lower the arrivals cache TTL, or split the cache (schedule rows cached for 60 s, realtime merged per request).

## Tests

- `merge-realtime.spec.ts` covers: a match by `stop_sequence` when stop_ids differ; departure-only first stop; skipped stop hidden; canceled trip hidden; late trip (scheduled 20 min ago, predicted in 5 min) included; past prediction excluded; `delaySeconds` computed; no prediction → `status: 'scheduled'`, `hasRealtime: false`.
- Update `reconcile-added-trips.spec.ts` for the new shape.

## How to verify against MBTA

Use the script `plan/tools-analyze-mbta-feed.py`, then compare a few stops by hand at the same moment: the app's `/api/v1/stops/:id/arrivals` against `https://api-v3.mbta.com/predictions?filter[stop]=<id>&sort=departure_time`. Use Park Street (`place-pktrm`), Alewife (`place-alfcl`, a terminal case), South Station CR (`place-sstat`, track-child case), and a busy bus stop. After PR 02 and PR 03, predicted times should match to the second, since both read the same Concentrate output. Remaining differences are only rounding and display rules (see PR 05).
