# Smaller functional bugs and dead code

**Type:** bug fixes and cleanup
**Touches:** `services/ingestion/src/gtfs-realtime.service.ts` (vehicles), `frontend/src/lib/api-client.ts`, `frontend/src/components/map/VehicleMap.tsx`, `services/agencies/src/agencies.controller.ts`, `services/stops/src/*`, `mark_tasks.py`
**Depends on:** PR 02 and PR 03 (they decide what happens to the added-trips code), PR 07 (`last_ingested_at`)

## Problem

1. **The vehicle payload doesn't match the frontend type.** Ingestion writes `{id, tripId, routeId, latitude, longitude, bearing, speed, timestamp, occupancyStatus}` (`gtfs-realtime.service.ts:59-69`), but the frontend expects `vehicleId`, `label` and `updatedAt` (`api-client.ts:108-118`). So every marker renders with `key={undefined}` (`VehicleMap.tsx:91`) and every popup says "Updated Invalid Date" (`:102`). Also, `timestamp` is epoch seconds as a string, and `occupancyStatus` is the enum *number* as a string.
2. **`lastIngestedAt` is always `null`** (hard-coded at `agencies.controller.ts:17`).
3. **Dead code:**
   - `mergeColocatedStops.ts` is used only by its own spec;
   - the `Stop`, `StopTime` and `Route` repositories injected into `StopsService` (`:29-31`) are unused;
   - `mark_tasks.py` is an empty file in the repo root;
   - the legacy `{legacy: {delay}}` parsing branch (`stops.service.ts:328-333`) is left over from the monolith and goes away with PR 03.
4. **`/health` is public and returns process uptime;** the nginx healthcheck probes agencies, not nginx itself.
5. **No request or correlation IDs**, so you can't follow one request across nginx → service logs.

## Changes

1. Define a `VehiclePosition` type in `packages/shared` and use it in both ingestion and the frontend: `vehicleId` (`vehicle.id ?? entity.id`), `label` (`vehicle.label`), `updatedAt`, `occupancyStatus` as the enum *name*. The GTFS-RT `VehiclePosition.timestamp` is an **optional** `uint64` in **POSIX seconds**. In the protobufjs static code that `gtfs-realtime-bindings` generates, an omitted field reads as the prototype default (`Long` 0), not `undefined`, so `ts != null` can't tell "absent" from "present". Use the presence check instead. Decode only sets the field as an own property when it's on the wire. **Confirm this against the installed bindings version in a unit test before relying on it.**
   ```ts
   const hasTs = Object.prototype.hasOwnProperty.call(vp, 'timestamp');
   const updatedAt = hasTs ? new Date(Number(vp.timestamp) * 1000).toISOString() : null;
   ```
   - **Absent** → `updatedAt: null`. Don't invent a value. If `feed.header.timestamp` exists, fill a separate field `feedTimestamp` from it.
   - **Explicitly present `0`** → a valid POSIX time: `1970-01-01T00:00:00.000Z`. Pass it through unchanged. Spotting implausible values is the frontend's job (e.g. show "Updated —" when older than 1 day).

   The shared type is `updatedAt: string | null`, and the frontend popup shows "Updated —" when it's null. Add a contract test that serializes the ingestion output and type-checks it against the frontend type, with three cases built by encoding real protobuf messages (not plain objects, so presence semantics hold): timestamp present (seconds → correct ISO), timestamp omitted (`null`), and timestamp explicitly `0` (`1970-01-01T00:00:00.000Z`).
2. Return `last_ingested_at` from the agencies table (written by PR 07).
3. Delete the dead code listed above, along with its spec.
4. nginx: `location = /health { access_log off; return 200 "ok"; }` for nginx's own healthcheck. Proxy service readiness at `/health/ready` only on the internal 8080 server (PR 01).
5. Add `X-Request-Id`: `proxy_set_header X-Request-Id $request_id;` in nginx, logged by the shared logger (PR 06).
