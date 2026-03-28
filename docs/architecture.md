# Architecture

## Overview

Transit Tracker is a six-service Docker Compose application that ingests GTFS static and realtime feeds from one or more transit agencies and serves a unified web interface.

```
                    ┌─────────────────────────────────────┐
                    │           NGINX :80                  │
                    │  rate-limit 60 req/min per IP        │
                    │  /api/* → backend:3000               │
                    │  /*     → frontend:3001              │
                    └────────────┬────────────┬────────────┘
                                 │            │
                    ┌────────────▼───┐  ┌─────▼──────────┐
                    │  Backend API   │  │   Frontend      │
                    │  NestJS :3000  │  │  Next.js :3001  │
                    └────┬───────┬──┘  └────────────────┘
                         │       │
          ┌──────────────▼─┐  ┌──▼──────────────┐
          │  PostgreSQL     │  │     Redis 7     │
          │  PostGIS :5432  │  │      :6379      │
          └─────────────────┘  └────────┬────────┘
                                        │
                    ┌───────────────────▼──────────────┐
                    │         Ingestion Worker         │
                    │   NestJS standalone process      │
                    │  • @Cron → GTFS static ingest    │
                    │  • @Interval(15s) → GTFS-RT poll │
                    └──────────────────────────────────┘
```

---

## Services

### NGINX (`:80`)

Reverse proxy and rate limiter. All traffic enters here.

- Routes `/api/*` → `backend:3000`
- Routes `/*` → `frontend:3001`
- `limit_req_zone` enforces 60 req/min per IP with burst=10
- 429 responses return JSON `{"error":"Rate limit exceeded","statusCode":429}` (not HTML)
- Config: [`nginx.conf`](../nginx.conf)

### Frontend (`frontend:3001`)

Next.js 14 App Router application. All pages are client components that fetch from `/api/v1` via the shared `api-client.ts`.

| Route | Page |
|-------|------|
| `/` | Route search (home) |
| `/(routes)/[routeId]` | Route detail — stops list, shape, alerts |
| `/stops` | Stop search |
| `/stops/[stopId]` | Stop departures table |
| `/stops/nearby` | Nearby stops (geolocation or manual coordinates) |
| `/map` | Live vehicle map (Leaflet, SSR disabled) |

Key conventions:
- `usePolling(intervalMs, fetcher)` — shared hook for all realtime-updating views
- MUI v6 named sub-path imports (`@mui/material/Button`) to stay within 150 KB initial chunk budget
- `next/dynamic({ ssr: false })` for VehicleMap (Leaflet requires browser APIs)

### Backend API (`backend:3000`)

NestJS 10 application. Serves the REST API at `/api/v1`. Modules:

| Module | Endpoints |
|--------|-----------|
| `RoutesModule` | `GET /routes`, `GET /routes/:id` |
| `StopsModule` | `GET /stops`, `GET /stops/nearby`, `GET /stops/:id/departures`, `GET /stops/:id/routes` |
| `TripsModule` | `GET /trips/:id` |
| `VehiclesModule` | `GET /vehicles/live` |
| `AlertsModule` | `GET /alerts` |
| `AgenciesModule` | `GET /agencies` |
| `HealthModule` | `GET /health` |
| `CacheModule` | Internal Redis wrapper (cache-aside) |

All routes and stops endpoints use a Redis cache-aside pattern. See [data-model.md](data-model.md#redis-cache-keys) for TTL values.

### Ingestion Worker

NestJS standalone application sharing the same codebase as the API. Runs two scheduled jobs:

- **`@Cron(GTFS_STATIC_CRON)`** — downloads the agency's GTFS static ZIP, validates it, parses all CSV files, and writes to PostgreSQL in a `SERIALIZABLE` transaction (DELETE-then-INSERT scoped by `agency_id`)
- **`@Interval(15 000)`** — fetches the GTFS-RT protobuf feed, decodes it, filters vehicle positions against known `trip_id` values, and writes to Redis with a 30 s TTL

The worker is a separate container (`Dockerfile.worker`) so it can be scaled or restarted independently without affecting the API.

### PostgreSQL + PostGIS (`db:5432`)

Static GTFS data source of truth. Key design decisions:

- All tables have an `agency_id UUID FK` column — row-level agency isolation with no schema duplication
- `stops.location` is a `GEOMETRY(Point, 4326)` column with a GiST index for PostGIS spatial queries
- `stop_times.departure_time` is stored as PostgreSQL `INTERVAL` to correctly handle GTFS post-midnight times (e.g. `25:30:00`)
- Ingestion uses a `SERIALIZABLE` transaction with 1 000-row batched INSERTs for ~500 K stop-time rows

### Redis (`cache:6379`)

Two uses:

1. **Realtime data** — `vehicles:{agencyKey}` and `alerts:{agencyKey}` STRING keys, 30 s TTL, written by the worker
2. **API response cache** — `cache:routes:*`, `cache:stop:departures:*`, `cache:stops:nearby:*` STRING keys, short TTLs (20–300 s)

When Redis is unreachable, `CacheService` returns `null` (no throw) and logs a `WARN`. The vehicles endpoint returns a `503`; all other endpoints degrade gracefully to live DB queries or empty arrays.

---

## Data Flow

### Static GTFS Ingestion

```
config/agencies.json
      │
      ▼
AgenciesService.getAllAgencies()
      │
      ▼
GtfsStaticService.ingest(agency)
  1. HTTP GET agency.gtfsStaticUrl → ZIP blob
  2. Validate Content-Type + byte size
  3. Extract CSV files from ZIP
  4. Parse routes.txt, stops.txt, trips.txt, stop_times.txt,
     shapes.txt, calendar.txt, calendar_dates.txt
  5. BEGIN SERIALIZABLE transaction
     DELETE FROM routes/stops/trips/... WHERE agency_id = $id
     INSERT in 1000-row batches
  6. COMMIT
  7. UPDATE agencies SET last_ingested_at = NOW()
```

### Realtime GTFS-RT Ingestion

```
GtfsRealtimeService.poll(agency)
  1. HTTP GET agency.gtfsRealtimeUrl (with API key header if set)
  2. FeedMessage.decode(buffer)         ← gtfs-realtime-bindings
  3. Build Set<string> of valid trip IDs from DB
  4. Filter VehiclePosition entities → discard unknown trip_ids (WARN)
  5. Redis pipeline:
       SET vehicles:{key} JSON(positions) EX 30
       SET alerts:{key}   JSON(alerts)    EX 30
  6. EXEC pipeline
```

### API Request (cache-aside)

```
GET /api/v1/stops/nearby?lat=42.36&lon=-71.06&radius=500
      │
      ▼
StopsController → validates lat/lon/radius
      │
      ▼
StopsService.getNearbyStops()
  1. CacheService.get('cache:stops:nearby:42.360:-71.060:500')
     ├── HIT  → return cached JSON
     └── MISS → PostGIS query:
                  SELECT ... FROM stops
                  WHERE ST_DWithin(location, $point, $radius)
                  ORDER BY location <-> $point
                  LIMIT 20
                  SET cache key EX 45
```

---

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | TypeORM 0.3 | NestJS native integration; supports PostGIS geometry columns via raw SQL escape hatches |
| Spatial queries | PostGIS ST_DWithin + `<->` KNN | GiST index makes radius + nearest-stop queries sub-50 ms at 9 K stops |
| Realtime protocol | GTFS-RT protobuf | Industry standard; `@googletag/gtfs-realtime-bindings` is the official Google decoder |
| Redis client | ioredis 5 | Non-blocking, pipeline support, connection retry built-in |
| Map library | react-leaflet + OpenStreetMap | No API key required; open license; `next/dynamic` eliminates SSR issues |
| UI library | MUI v6 | Tree-shakeable via named sub-path imports; WCAG 2.1 AA components out of box |
| Proxy | NGINX | Native `limit_req_zone` for per-IP rate limiting without application code |

---

## Performance Targets

| Metric | Target | Mechanism |
|--------|--------|-----------|
| API p95 latency | ≤ 200 ms | Redis cache-aside; PostGIS GiST index |
| Frontend initial load | ≤ 3 s | Next.js code splitting; MUI named imports |
| Initial JS chunk | ≤ 150 KB gzipped | `next/dynamic` for Leaflet; named MUI imports |
| Vehicle position staleness | ≤ 30 s | 15 s server-side poll + 15 s client-side poll |
| GTFS-RT processing | ≤ 5 s | Protobuf decode + Redis pipeline write |
| Concurrent users | 500 | NGINX rate limiting; Redis cache absorbs read load |
