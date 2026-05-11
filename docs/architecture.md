# Architecture

## Overview

Transit Tracker is a six-service Docker Compose application that ingests GTFS static and realtime feeds from one or more transit agencies and serves a unified web interface.

```
                        ┌─────────────────────┐
                        │ NGINX :80/:443       │
                        │ routes by path prefix│
                        └──┬──┬──┬──┬──┬──┬───┘
          ┌─────────────────┘  │  │  │  │  │
          │    ┌───────────────┘  │  │  │  │
          │    │    ┌─────────────┘  │  │  │
          │    │    │    ┌───────────┘  │  │
          │    │    │    │    ┌─────────┘  │
          ▼    ▼    ▼    ▼    ▼            ▼
      agencies routes stops alerts vehicles frontend
       :3001   :3002 :3003 :3004  :3005   :3001

        ┌─────┴─────────┐          ┌─┴──────────┐
        │ PostgreSQL    │          │  Redis 7    │
        │ PostGIS :5432 │          │   :6379     │
        └───────────────┘          └─┬───────────┘
                                     │
                           ┌─────────▼───────────┐
                           │    ingestion         │
                           │  NestJS worker       │
                           │  @Cron + @Interval   │
                           └─────────────────────┘
```

---

## Services

### NGINX (`:80/:443`)

Reverse proxy and rate limiter. All traffic enters here. Routes `/api/v1/*` by path prefix to the appropriate microservice:

| Path prefix        | Upstream        |
| ------------------ | --------------- |
| `/api/v1/stops`    | `stops:3003`    |
| `/api/v1/routes`   | `routes:3002`   |
| `/api/v1/trips`    | `routes:3002`   |
| `/api/v1/alerts`   | `alerts:3004`   |
| `/api/v1/vehicles` | `vehicles:3005` |
| `/api/v1/agencies` | `agencies:3001` |
| `/*`               | `frontend:3001` |

- `limit_req_zone` enforces 60 req/min per IP with burst=10
- 429 responses return JSON `{"error":"Rate limit exceeded","statusCode":429}` (not HTML)
- Config: [`nginx.conf`](../nginx.conf)

### Frontend (`frontend:3001`)

Next.js 14 App Router application. All pages are client components that fetch from `/api/v1` via the shared `api-client.ts`. Server-side rendering uses `BACKEND_URL=http://nginx:80` for API proxy rewrites.

| Route                 | Page                                             |
| --------------------- | ------------------------------------------------ |
| `/`                   | Route search (home)                              |
| `/(routes)/[routeId]` | Route detail — stops list, shape, alerts         |
| `/stops`              | Stop search                                      |
| `/stops/[stopId]`     | Stop arrivals table                              |
| `/stops/nearby`       | Nearby stops (geolocation or manual coordinates) |
| `/map`                | Live vehicle map (Leaflet, SSR disabled)         |

Key conventions:

- `usePolling(intervalMs, fetcher)` — shared hook for all realtime-updating views
- MUI v6 named sub-path imports (`@mui/material/Button`) to stay within 150 KB initial chunk budget
- `next/dynamic({ ssr: false })` for VehicleMap (Leaflet requires browser APIs)

### Microservices

Each domain is a standalone NestJS 10 application in `services/<name>/`. All services share TypeORM entities via the `@transit-tracker/shared` package (`packages/shared/`).

| Service     | Port | Endpoints                                                                             | Data source        | Depends on |
| ----------- | ---- | ------------------------------------------------------------------------------------- | ------------------ | ---------- |
| `agencies`  | 3001 | `GET /agencies`                                                                       | config file        | —          |
| `routes`    | 3002 | `GET /routes`, `GET /routes/:id`, `GET /routes/:id/shape`, `GET /trips/:id`           | PostgreSQL         | db, cache  |
| `stops`     | 3003 | `GET /stops`, `GET /stops/nearby`, `GET /stops/:id/arrivals`, `GET /stops/:id/routes` | PostgreSQL         | db, cache  |
| `alerts`    | 3004 | `GET /alerts`                                                                         | Redis              | cache      |
| `vehicles`  | 3005 | `GET /vehicles/live`                                                                  | Redis              | cache      |
| `ingestion` | —    | Worker process (no HTTP) — `@Cron` + `@Interval(15s)`                                 | PostgreSQL + Redis | db, cache  |

#### Branching route detection (`GET /routes/:id`)

Some routes fork into multiple terminal branches (e.g. the MBTA Red Line splits into Ashmont and Braintree branches), and routes may also have distinct inbound and outbound destinations (e.g. route 713: two outbound headsigns, one inbound headsign). The route detail endpoint detects all of this automatically:

1. All trips for the route across **both** `direction_id = 0` and `direction_id = 1` are grouped by `(direction_id, trip_headsign)`.
2. `DISTINCT ON (direction_id, trip_headsign)` with `ORDER BY direction_id, trip_headsign, stop_count DESC` selects the longest representative trip per unique `(direction, headsign)` pair.
3. The response includes a `branches` array, each element containing `label` (the headsign), `directionId` (0 = outbound, 1 = inbound), and the ordered `stops` list for that branch.
4. The flat `stops` field (longest single branch) is preserved for backward compatibility.

The frontend renders all branches in a responsive grid when `branches.length > 1`.

#### Stop search hierarchy (`GET /stops`)

GTFS feeds use a parent/child stop hierarchy:

- **Parent stations** (e.g. `place-asmnl` — "Ashmont") represent the physical hub. Their `parent_station_id` field is blank (empty string `''` after CSV ingestion).
- **Child stops** (individual platforms/entrances, e.g. `70093`, `70094`) have `parent_station_id` set to their parent's `stop_id`.

The search endpoint filters to `parent_station_id IS NULL OR parent_station_id = ''` to return one result per station rather than one per platform. Note: GTFS blank CSV fields are ingested as empty strings, not SQL `NULL`, so both conditions are required.

#### Co-located bus stop merging (`GET /stops`)

Bus stops in GTFS feeds often have no parent station. Opposite-direction platforms at the same intersection are separate stop records with different `stop_id` values, the same `stop_name`, and very similar coordinates. Without merging, a search for "Washington St" would return two near-identical rows — one for each platform.

After the paginated SQL query runs, `mergeColocatedStops()` collapses these in application code using three criteria — all three must hold:

1. **Same `stop_name`**
2. **Within `~150 m`** (geodesic approximation using degree offsets: `150 / 111_320 °`)
3. **Share at least one `route_id`** — prevents unrelated stops at wide intersections from being merged

The first stop in each group is kept as the canonical entry. Its `routes` list becomes the union of all merged stops' routes, deduplicated by `routeId` and sorted by `shortName`.

The `getArrivals` endpoint performs a matching neighbor lookup via PostGIS `ST_DWithin` so that clicking a merged stop shows arrivals from all co-located platforms (both inbound and outbound). See [data-model.md](data-model.md#redis-cache-keys) for TTL values.

### Ingestion Worker

NestJS standalone application sharing the same codebase as the API. Runs two scheduled jobs:

- **`@Cron(GTFS_STATIC_CRON)`** — downloads the agency's GTFS static ZIP, validates it, parses all CSV files, and writes to PostgreSQL in a `SERIALIZABLE` transaction (DELETE-then-INSERT scoped by `agency_id`)
- **`@Interval(15 000)`** — fetches the GTFS-RT protobuf feed, decodes it, filters vehicle positions against known `trip_id` values, and writes to Redis with a 30 s TTL

The worker is a separate container (`Dockerfile.worker`) so it can be scaled or restarted independently without affecting the API.

### PostgreSQL + PostGIS (`db:5432`)

Static GTFS data source of truth. Key design decisions:

- All tables have an `agency_id UUID FK` column — row-level agency isolation with no schema duplication
- `stops.location` is a `GEOMETRY(Point, 4326)` column with a GiST index for PostGIS spatial queries
- `stop_times.departure_time` (GTFS/DB field, not user-facing; all user-facing references use arrivals terminology) is stored as PostgreSQL `INTERVAL` to correctly handle GTFS post-midnight times (e.g. `25:30:00`)
- Ingestion uses a `SERIALIZABLE` transaction with 1 000-row batched INSERTs for ~500 K stop-time rows

### Redis (`cache:6379`)

Two uses:

1. **Realtime data** — `vehicles:{agencyKey}` and `alerts:{agencyKey}` STRING keys, 30 s TTL, written by the worker
2. **API response cache** — `cache:routes:*`, `cache:stop:arrivals:*`, `cache:stops:nearby:*` STRING keys, short TTLs (20–300 s)

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
  1. HTTP GET agency.gtfsRealtimeVehiclePositionsUrl (with API key header if set)
  2. FeedMessage.decode(buffer)         ← gtfs-realtime-bindings
  3. Build Set<string> of valid trip IDs from DB
  4. Filter VehiclePosition entities → discard unknown trip_ids (WARN)
  5. For each TripUpdate entity:
       a. trip_id in valid set  → scheduled trip: record delay (first stop_time_update)
                                  stored as  trip_updates:{agencyKey}  HSET tripId → delaySeconds
       b. trip_id not in valid set → ADDED / unscheduled trip: collect absolute
                                  stop arrival timestamps per stop_id
                                  stored as  added_trips:{agencyKey}   HSET tripId → JSON
  6. Redis pipeline:
       SET  vehicles:{key}     JSON(positions)   EX 30
       SET  alerts:{key}       JSON(alerts)      EX 30
       HSET trip_updates:{key} {tripId: delay …} EX 90
       HSET added_trips:{key}  {tripId: data  …} EX 90
  7. EXEC pipeline
```

### ADDED Trip Reconciliation (Stop Arrivals)

Many agencies (including MBTA) publish realtime predictions for their scheduled trips
under opaque `ADDED-xxxx` trip IDs rather than the static GTFS `trip_id`. Naively
appending ADDED trips as extra rows causes each train to appear twice — once from the
static schedule and once from the realtime feed.

`StopsService.getArrivals()` reconciles ADDED trips against the scheduled arrivals
using a nearest-neighbour match:

```
For each ADDED trip at this stop (sorted by arrival time ascending):
  1. Find the closest unmatched scheduled trip with the same routeId AND directionId
      whose scheduled arrival is within RECONCILE_WINDOW (5 min) of the ADDED time.
  2a. Match found →
        realtimeDelaySeconds = addedTime − scheduledTime   (negative = running early)
        hasRealtime          = true
        Scheduled slot is marked "consumed" (one-to-one mapping)
  2b. No match (genuinely extra service, e.g. shuttle or unplanned trip) →
      Append as a new arrival row with hasRealtime = true
```

**Why sort ascending first?** On high-frequency routes (e.g. 2-min headways) processing
order matters. If an ADDED trip at T+1:45 is processed before one at T+0:55, the first
might "steal" the T+2:00 scheduled slot that belongs to the second, causing a cascade of
wrong matches. Ascending order ensures each ADDED trip claims its closest _earlier_ slot
before later trips are considered.

**Headsign fallback:** Because GTFS-RT ADDED trips never carry a `trip_headsign`, the
reconciler looks up the representative headsign for the `(routeId, directionId)` pair
from the static schedule and applies it to any unmatched ADDED row.

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

| Decision          | Choice                         | Rationale                                                                               |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| ORM               | TypeORM 0.3                    | NestJS native integration; supports PostGIS geometry columns via raw SQL escape hatches |
| Spatial queries   | PostGIS ST_DWithin + `<->` KNN | GiST index makes radius + nearest-stop queries sub-50 ms at 9 K stops                   |
| Realtime protocol | GTFS-RT protobuf               | Industry standard; `@googletag/gtfs-realtime-bindings` is the official Google decoder   |
| Redis client      | ioredis 5                      | Non-blocking, pipeline support, connection retry built-in                               |
| Map library       | react-leaflet + OpenStreetMap  | No API key required; open license; `next/dynamic` eliminates SSR issues                 |
| UI library        | MUI v6                         | Tree-shakeable via named sub-path imports; WCAG 2.1 AA components out of box            |
| Proxy             | NGINX                          | Native `limit_req_zone` for per-IP rate limiting without application code               |

---

## Performance Targets

| Metric                     | Target           | Mechanism                                          |
| -------------------------- | ---------------- | -------------------------------------------------- |
| API p95 latency            | ≤ 200 ms         | Redis cache-aside; PostGIS GiST index              |
| Frontend initial load      | ≤ 3 s            | Next.js code splitting; MUI named imports          |
| Initial JS chunk           | ≤ 150 KB gzipped | `next/dynamic` for Leaflet; named MUI imports      |
| Vehicle position staleness | ≤ 30 s           | 15 s server-side poll + 15 s client-side poll      |
| GTFS-RT processing         | ≤ 5 s            | Protobuf decode + Redis pipeline write             |
| Concurrent users           | 500              | NGINX rate limiting; Redis cache absorbs read load |
