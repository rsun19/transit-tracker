# Research: GTFS Transit Tracker Web Application

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28  
**Status**: Complete — all NEEDS CLARIFICATION items resolved

---

## R1: GTFS-Realtime Protobuf Parsing (Node.js)

**Decision**: Use `@googletag/gtfs-realtime-bindings` v0.0.9 (official Google package)

**Rationale**:  
The `@googletag` scoped package is the official Google-maintained binding for GTFS-Realtime protobuf. It ships pre-compiled JavaScript message classes for `FeedMessage`, `VehiclePosition`, `TripUpdate`, and `Alert` — no `.proto` compilation required. Version v0.0.9 is production-stable for the core spec.

**Key usage pattern**:

```typescript
import { transit_realtime } from '@googletag/gtfs-realtime-bindings';

const feed = transit_realtime.FeedMessage.decode(binaryBuffer);
const vehiclePositions = feed.entity
  .filter((e) => e.vehicle?.position)
  .map((e) => ({
    vehicleId: e.id,
    lat: e.vehicle.position.latitude,
    lon: e.vehicle.position.longitude,
    routeId: e.vehicle.trip?.route_id,
    tripId: e.vehicle.trip?.trip_id,
    updatedAt: Number(e.vehicle.timestamp),
  }));
```

**Alternatives considered**:

- `protobufjs` direct: requires manual proto file compilation; unnecessary complexity
- `gtfs-realtime-bindings` (unscoped): deprecated third-party package; will break on spec updates
- Manual binary parsing: no type safety; unmaintainable

---

## R2: PostGIS Geospatial Query Pattern for Nearest Stops

**Decision**: Combine `ST_DWithin` for radius enforcement with `<->` KNN ordering for sort-by-distance performance

**Rationale**:  
The spec requires stops within a configurable radius (default 500 m), sorted by distance. `ST_DWithin` enforces the radius bound using the spatial index efficiently (avoids full-table scan). The `<->` KNN operator provides fast sorted ordering. Using both together hits the spatial index twice, but with a GiST index on a `GEOMETRY(Point, 4326)` column, this is the correct pattern for bounded nearest-stop lookups.

**Schema**: Store stop geometry as `GEOMETRY(Point, 4326)` (WGS84 lat/lon — the GTFS coordinate system). Create a GiST index.

```sql
CREATE INDEX idx_stops_location_gist ON stops USING GIST(location);

-- Nearby stops query
SELECT
  stop_id, stop_name, stop_code,
  ST_Y(location) AS latitude,
  ST_X(location) AS longitude,
  ST_Distance(location::geography, ST_SetSRID(ST_Point($lon, $lat), 4326)::geography) AS distance_m
FROM stops
WHERE ST_DWithin(
  location::geography,
  ST_SetSRID(ST_Point($lon, $lat), 4326)::geography,
  $radius_m  -- default 500
)
ORDER BY location <-> ST_SetSRID(ST_Point($lon, $lat), 4326)
LIMIT 20;
```

Note: `ST_Point(lon, lat)` — PostGIS takes X (longitude) first, then Y (latitude).

**Alternatives considered**:

- KNN-only (`<->` without `ST_DWithin`): no radius enforcement; returns nearest regardless of distance; doesn't meet FR-004
- Haversine in application code: full table scan; no index benefit; unacceptable at scale
- BRIN index: smaller footprint but slower for spatial KNN; GiST index is correct choice

---

## R3: PostgreSQL Atomic Re-ingestion Pattern

**Decision**: TypeORM QueryRunner with `SERIALIZABLE` transaction — DELETE by `agency_id` then INSERT

**Rationale**:  
The multi-agency requirement rules out `TRUNCATE` (deletes all agencies). Shadow table rename adds schema management complexity. The correct approach is a single `SERIALIZABLE` transaction that deletes all rows for the target agency (by `agency_id` FK), then bulk-inserts new rows. This is atomic: concurrent readers see either the complete old set or the complete new set — never a partial state.

Deletion order must respect FK constraints: `stop_times` → `trips` → `shapes`, `calendar_dates` → then `stops`, `routes` at the agency level.

**Pattern**:

```typescript
const qr = dataSource.createQueryRunner();
await qr.startTransaction('SERIALIZABLE');
try {
  await qr.query(
    `DELETE FROM stop_times WHERE trip_id IN (SELECT trip_id FROM trips WHERE agency_id=$1)`,
    [agencyId],
  );
  await qr.query(`DELETE FROM trips WHERE agency_id=$1`, [agencyId]);
  await qr.query(`DELETE FROM stop_times_calendar WHERE agency_id=$1`, [agencyId]);
  await qr.query(`DELETE FROM shapes WHERE agency_id=$1`, [agencyId]);
  await qr.query(`DELETE FROM stops WHERE agency_id=$1`, [agencyId]);
  await qr.query(`DELETE FROM routes WHERE agency_id=$1`, [agencyId]);
  // bulk insert new rows via parameterized INSERT or COPY
  await qr.commitTransaction();
} catch (e) {
  await qr.rollbackTransaction();
  throw e;
} finally {
  await qr.release();
}
```

**Alternatives considered**:

- TRUNCATE: deletes all agencies; rejected
- Shadow table rename: correct but complex schema management; unnecessary for daily batch jobs
- Upsert per row: N+1 operations on 500K+ rows; not atomic; too slow

---

## R4: Redis Key Design for Vehicle Positions

**Decision**: `HSET vehicles:{agencyId}` with `vehicleId` as hash field and JSON value; TTL of 30 s on the key

**Rationale**:  
The API endpoint (`GET /api/v1/vehicles/live`) requires fetching all vehicles for an agency in a single call. `HGETALL vehicles:mbta` retrieves all entries in O(1) network roundtrip. Individual vehicle updates use `HSET vehicles:mbta vehicleId '{...}'` — O(1). Setting `EXPIRE vehicles:mbta 30` on every batch write automatically purges stale data if polling stops. Pipeline all per-vehicle `HSET` calls for a single feed update to minimize round-trips.

```typescript
const key = `vehicles:${agencyId}`;
const pipeline = redis.pipeline();
for (const v of positions) {
  pipeline.hset(key, v.vehicleId, JSON.stringify(v));
}
pipeline.expire(key, 30);
await pipeline.exec();

// API read
const all = await redis.hgetall(`vehicles:${agencyId}`);
return Object.values(all).map((v) => JSON.parse(v));
```

**Alternatives considered**:

- One key per vehicle + SCAN: requires SCAN across potentially 5,000 keys per agency; O(N) with cursor iteration
- Single JSON blob per agency: must deserialize full blob to update one vehicle; 500-vehicle fleet × 15s intervals = high serialization cost
- Redis Streams: overkill; designed for event sourcing and consumer groups, not latest-state lookup

---

## R5: Next.js 14 + Leaflet/React-Leaflet SSR Compatibility

**Decision**: `next/dynamic` with `ssr: false` for all Leaflet-dependent components; react-leaflet v4.2.x

**Rationale**:  
Leaflet uses `window`, `document`, and DOM event APIs that are unavailable during Next.js server-side rendering. The only correct fix is disabling SSR for Leaflet components via `next/dynamic`. All map components must also be marked `'use client'`. React-Leaflet v4.2.x is stable with Next.js 14 App Router.

```typescript
// page.tsx (App Router)
import dynamic from 'next/dynamic';

const VehicleMap = dynamic(() => import('@/components/VehicleMap'), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});
```

```typescript
// components/VehicleMap.tsx
'use client';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
// ... component implementation
```

Package versions: `leaflet@^1.9.4`, `react-leaflet@^4.2.3`, `@types/leaflet@^1.9.8`

**Known issue**: Leaflet's default icon assets resolve via `_getIconUrl` which breaks in webpack. Fix by calling `delete L.Icon.Default.prototype._getIconUrl` and supplying explicit icon URLs at app initialization.

**Alternatives considered**:

- `useEffect` with conditional import: works but increases bundle size (not code-split); less idiomatic
- Mapbox GL JS: SSR-compatible but proprietary tiles require API key; contradicts OpenStreetMap requirement
- `@vis.gl/react-maplibre`: modern SSR-compatible option but diverges from the specified OpenStreetMap+Leaflet approach

---

## R6: NGINX Rate Limiting Configuration

**Decision**: `limit_req_zone` at `1r/s` (= 60 req/min) with `burst=10 nodelay`; applied to `/api/` location block; custom `429` JSON response

**Rationale**:  
NGINX leaky-bucket rate limiting via `limit_req_zone` is the most efficient approach — handled at the proxy layer before any application code runs. `burst=10` allows short spikes (a page making 5–8 parallel API calls at load) without triggering 429. `nodelay` rejects excess immediately rather than queueing. Applied to `/api/` only — frontend static assets should not be rate-limited.

```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=1r/s;

location /api/ {
  limit_req zone=api_limit burst=10 nodelay;
  limit_req_status 429;
  proxy_pass http://backend;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location @rate_limit_429 {
  default_type application/json;
  return 429 '{"error":"Too many requests","retryAfter":60}';
}
```

**Alternatives considered**:

- NestJS `@nestjs/throttler` or `express-rate-limit`: application-layer; rate limits after backend startup; less efficient
- Redis-backed rate limiter: appropriate for distributed multi-node deployments; over-engineered for single-node Docker Compose
- `limit_req` on all routes including frontend: frontend assets are static and don't need per-IP limiting

---

## R7: Docker Compose Health Checks

**Decision**: Per-service health checks with `condition: service_healthy`; worker uses liveness file instead of HTTP endpoint

**Rationale**:  
`pg_isready` is the canonical Postgres liveness check. `redis-cli ping` for Redis. HTTP `curl /health` for backend (NestJS) and frontend (Next.js). The worker has no HTTP server; use a file-based liveness check (worker writes a heartbeat file every N seconds; health check reads it). NGINX depends on `backend` and `frontend` both being healthy.

```yaml
postgres:
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U gtfs_user -d gtfs_db']
    interval: 5s
    timeout: 3s
    retries: 5
    start_period: 10s

redis:
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    timeout: 2s
    retries: 5

backend:
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
    interval: 10s
    timeout: 3s
    retries: 5
    start_period: 20s

frontend:
  depends_on:
    backend: { condition: service_healthy }
  healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:3000/api/health']
    interval: 10s
    timeout: 3s
    retries: 5
    start_period: 15s

worker:
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  healthcheck:
    test:
      [
        'CMD-SHELL',
        'test -f /tmp/worker-alive && [ $(( $(date +%s) - $(stat -c %Y /tmp/worker-alive) )) -lt 120 ]',
      ]
    interval: 30s
    timeout: 5s
    retries: 3
```

**Alternatives considered**:

- No health checks (just `depends_on` without condition): only checks container start, not service readiness; causes race conditions on first startup
- Custom HTTP server in worker: adds unnecessary complexity for a background job
- `start_period` omitted: health checks fire immediately; backend fails before NestJS finishes bootstrapping (migrations, module initialization)

---

## Summary of All Decisions

| Area                   | Decision                                                      | Package/Version                      |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------ |
| GTFS-RT parsing        | `@googletag/gtfs-realtime-bindings`                           | v0.0.9                               |
| Geospatial query       | `ST_DWithin` + `<->` KNN, `GEOMETRY(Point, 4326)`, GiST index | PostGIS 3.4                          |
| Atomic re-ingestion    | SERIALIZABLE transaction, DELETE by `agency_id` + INSERT      | TypeORM QueryRunner                  |
| Vehicle position cache | `HSET vehicles:{agencyId}`, TTL 30s, Redis pipeline           | ioredis v5                           |
| Map rendering          | `next/dynamic` + `ssr: false`, react-leaflet                  | react-leaflet v4.2.3, leaflet v1.9.4 |
| Rate limiting          | NGINX `limit_req_zone` 1r/s, burst=10, `/api/` only           | nginx 1.27-alpine                    |
| Health checks          | Service-specific: pg_isready / redis-cli ping / curl /health  | Docker Compose v3.8+                 |
