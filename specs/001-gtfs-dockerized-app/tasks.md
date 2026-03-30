# Tasks: GTFS Transit Tracker Web Application

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28  
**Input**: Design documents from `/specs/001-gtfs-dockerized-app/`  
**Artifacts used**: plan.md, spec.md, data-model.md, contracts/api.md, research.md, quickstart.md

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelisable — operates on distinct files with no incomplete-task dependencies
- **[US#]**: User Story scope — US1 (Route/Stop Discovery), US2 (Live Vehicles), US3 (Nearby Stops), US4 (Multi-Agency)
- Setup and Foundational tasks carry no story label (they serve all stories)
- Every task includes an exact file path

---

## Implementation Strategy

**MVP scope** is User Story 1 (P1) only: complete Phases 1–3 to deliver a fully functional static schedule browser. Phases 4–7 add realtime tracking, geospatial discovery, and multi-agency support as independent increments. Each phase checkpoint is independently testable before proceeding.

**Recommended execution order**:
1. Phase 1 → Phase 2 (strict sequential — foundational)
2. Phase 3 (US1 frontend and backend tasks can be worked in parallel streams)
3. Phase 4–7 (phases are independent from each other once Phase 3 is done)

---

## Phase 1: Setup

**Purpose**: Monorepo scaffold, Docker infrastructure, shared configuration. No user story work begins until this phase is complete.

- [X] T001 Create full monorepo directory structure: `frontend/`, `backend/`, `config/`, `docker/`, root-level `nginx.conf`, `.gitignore`, `.env.example` per plan.md Project Structure
- [X] T002 Initialize `backend/package.json` — install NestJS 10, `@nestjs/config`, `@nestjs/schedule`, TypeORM 0.3, `pg`, `ioredis` 5, `@googletag/gtfs-realtime-bindings` 0.0.9, `csv-parser`, `node-fetch`, `zod`, Jest 29, Supertest
- [X] T003 [P] Initialize `frontend/package.json` — install Next.js 14, `@mui/material` 6, `@mui/icons-material` 6, `@emotion/react`, `@emotion/styled`, `react-leaflet` 4.2, `leaflet` 1.9, `jest` 29, `@testing-library/react`, `jest-axe`, TypeScript 5.3
- [X] T004 [P] Create root `tsconfig.base.json` with `strict: true`, `target: ES2022`, `module: NodeNext`; create `backend/tsconfig.json` and `frontend/tsconfig.json` extending base
- [X] T005 [P] Configure ESLint (`@typescript-eslint/recommended`) and Prettier for both `backend/` and `frontend/`; add `lint` and `format` npm scripts to each package
- [X] T006 Create `docker-compose.yml` with all six services: `postgis/postgis:16-3.4-alpine` (db), `redis:7.2-alpine` (cache), `nginx:1.27-alpine`, backend (API), worker, frontend; include `healthcheck` entries for every service and `depends_on: condition: service_healthy` dependency chain
- [X] T007 [P] Create `docker-compose.dev.yml` overriding `docker-compose.yml` with source volume mounts and hot-reload command overrides for backend and frontend
- [X] T008 Create `nginx.conf` — `limit_req_zone $binary_remote_addr zone=api:10m rate=1r/s` on `/api/` prefix with `burst=10 nodelay`; `proxy_pass http://backend:3000` for `/api`; `proxy_pass http://frontend:3001` for `/`; `error_page 429` returning `Content-Type: application/json` body `{"error":"Rate limit exceeded","statusCode":429}`
- [X] T009 [P] Create `.env.example` documenting all env vars: `DATABASE_URL`, `REDIS_URL`, `AGENCY_CONFIG_PATH`, `MBTA_API_KEY`, `GTFS_STATIC_CRON`, `GTFS_REALTIME_POLL_INTERVAL_MS`, `NODE_ENV`
- [X] T010 Create `docker/init-db.sql` — `CREATE EXTENSION IF NOT EXISTS postgis;` and `CREATE EXTENSION IF NOT EXISTS postgis_topology;` run on PostgreSQL container first-start
- [X] T011 Create `config/agencies.json` with one MBTA entry: `{key, displayName, timezone, gtfsStaticUrl, gtfsRealtimeUrl, apiKeyEnvVar}` following schema documented in quickstart.md
- [X] T012 [P] Create `backend/src/common/constants.ts` declaring all named constants: `NEARBY_DEFAULT_RADIUS_M`, `NEARBY_MAX_RADIUS_M`, `VEHICLE_CACHE_TTL_S=30`, `API_CACHE_DEPARTURES_TTL_S=20`, `API_CACHE_ROUTES_TTL_S=300`, `API_CACHE_NEARBY_TTL_S=45`, `REALTIME_POLL_INTERVAL_MS=15000`, `DEFAULT_SEARCH_LIMIT=20`, `MAX_SEARCH_LIMIT=100`

**Checkpoint**: All Docker infrastructure and project skeletons are in place. Run `docker compose build` to verify images build cleanly.

---

## Phase 2: Foundational

**Purpose**: TypeORM entities, NestJS core infrastructure, GTFS static ingestion worker. **No user story implementation can begin until this phase is complete.**

**⚠️ CRITICAL**: Every subsequent phase depends on the database schema and ingestion pipeline being operational.

### Entities (can be worked in parallel)

- [X] T013 Create TypeORM `Agency` entity in `backend/src/modules/agencies/entities/agency.entity.ts` — all columns per data-model.md: `agency_id UUID PK`, `agency_key VARCHAR(50) UNIQUE`, `display_name`, `timezone`, `gtfs_static_url`, `gtfs_realtime_url`, `api_key_env_var`, `last_ingested_at TIMESTAMPTZ`, `created_at`
- [X] T014 [P] Create TypeORM `Route` entity in `backend/src/modules/routes/entities/route.entity.ts` — `UNIQUE(agency_id, route_id)`, `INDEX ON (agency_id, route_type)`, `ManyToOne` to Agency with `ON DELETE CASCADE`
- [X] T015 [P] Create TypeORM `Stop` entity in `backend/src/modules/stops/entities/stop.entity.ts` — `location GEOMETRY(Point, 4326)` with `@Index({spatial: true})` for GiST, `UNIQUE(agency_id, stop_id)`, `INDEX ON (agency_id, stop_code)`
- [X] T016 [P] Create TypeORM `Trip` entity in `backend/src/modules/trips/entities/trip.entity.ts` — `UNIQUE(agency_id, trip_id)`, `INDEX ON (agency_id, route_id)`, `INDEX ON (agency_id, service_id)`
- [X] T017 [P] Create TypeORM `StopTime` entity in `backend/src/modules/stops/entities/stop-time.entity.ts` — `departure_time` as `INTERVAL` (seconds past midnight, allowing >24:00 per GTFS), `INDEX ON (agency_id, trip_id, stop_sequence)`, `INDEX ON (agency_id, stop_id, departure_time)`
- [X] T018 [P] Create TypeORM `Shape` entity in `backend/src/modules/ingestion/entities/shape.entity.ts` — `location GEOMETRY(Point, 4326)`, `INDEX ON (agency_id, shape_id, pt_sequence)` for ordered shape point retrieval
- [X] T019 [P] Create TypeORM `ServiceCalendar` entity in `backend/src/modules/ingestion/entities/service-calendar.entity.ts` — `UNIQUE(agency_id, service_id)`, seven boolean day columns, `start_date DATE`, `end_date DATE`

### Backend Infrastructure

- [X] T020 Implement `backend/src/config/configuration.ts` — `@nestjs/config` `ConfigModule` with `isGlobal: true` and Zod schema validating all required env vars; process exits with descriptive error on startup if any required var is missing (fail-fast)
- [X] T021 Implement global HTTP exception filter in `backend/src/common/filters/http-exception.filter.ts` — catches all exceptions, returns `{error: string, statusCode: number}` JSON; no stack traces in response body (OWASP A05 — Information Exposure)
- [X] T022 [P] Configure JSON structured logging in `backend/src/main.ts` — override NestJS `Logger` to emit `{timestamp, level, service, message}` JSON objects to stdout on every log call (FR-022)
- [X] T023 Implement `CacheModule` in `backend/src/modules/cache/cache.module.ts` — `ioredis` client singleton, retry strategy: 3 attempts with 500 ms geometric backoff, `enableReadyCheck: true`, connection error events captured and logged as WARN
- [X] T024 Implement `CacheService` in `backend/src/modules/cache/cache.service.ts` — `get(key)`, `set(key, value, ttlSeconds)`, `del(key)` methods; on any `ioredis` error: log WARN and return `null` (cache miss signal enabling caller to fall back to PostgreSQL — FR-024); never throws to callers

### Agency Configuration

- [X] T025 Implement `AgenciesService` in `backend/src/modules/agencies/agencies.service.ts` — read `config/agencies.json` from path in `AGENCY_CONFIG_PATH` env var; validate each entry's required fields; resolve `apiKeyEnvVar` to `process.env[entry.apiKeyEnvVar]` at startup; expose `getAllAgencies()` and `getAgencyByKey(key)` methods (FR-010, FR-016)

### GTFS Static Ingestion

- [X] T026 Implement `GtfsStaticService` in `backend/src/modules/ingestion/gtfs-static.service.ts`: (1) download ZIP via `node-fetch`, validate `Content-Type` is `application/zip`/`application/octet-stream` and minimum byte-size sanity check before proceeding (FR-025); (2) extract and parse `routes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt`, `calendar.txt` using `csv-parser` streaming; (3) wrap all writes in TypeORM `QueryRunner` with `SERIALIZABLE` isolation: `DELETE WHERE agency_id = X` then `INSERT` all parsed rows — committed atomically or fully rolled back on error (FR-019, FR-025)
- [X] T027 Implement `IngestionScheduler` in `backend/src/modules/ingestion/ingestion.scheduler.ts` — `@Cron(process.env.GTFS_STATIC_CRON ?? '0 4 * * *')` method iterating all configured agencies sequentially; one agency's failure (download error, parse error, malformed ZIP) is caught and logged at ERROR, does not halt remaining agencies (FR-006, US4 AS3)
- [X] T028 Create `backend/src/worker.ts` — NestJS standalone application bootstrapping only `IngestionModule` (no HTTP server); write a file-based liveness signal at startup to `WORKER_FILE_LIVENESS_PATH` env var path; graceful shutdown on `SIGTERM`
- [X] T029 Implement `HealthController` in `backend/src/modules/health/health.controller.ts` — `GET /health` returns `{status: 'ok', uptime: process.uptime()}`; used by Docker Compose `healthcheck: CMD curl -f http://localhost:3000/health` (FR-021)
- [X] T030 Create `backend/src/main.ts` — bootstrap `AppModule`, apply `HttpExceptionFilter` globally, restrict CORS to same-origin (`origin: false`) for security, listen on port `3000`
- [X] T031 [P] Create multi-stage Dockerfiles: `backend/Dockerfile` (node:20-alpine builder → `npm ci --omit=dev` → `main.ts` CMD), `backend/Dockerfile.worker` (same base, `worker.ts` CMD), `frontend/Dockerfile` (node:20-alpine builder → `next build` → standalone output)

**Checkpoint**: Run `docker compose up db cache` then manually trigger `GtfsStaticService.ingestAgency()` for MBTA. Confirm all seven tables are populated. `GET /health` returns 200.

---

## Phase 3: User Story 1 — Route & Stop Discovery (Priority: P1) 🎯 MVP

**Goal**: A rider can search for routes by name, view stop sequences and departure times for the current service day — using only ingested static GTFS data with no realtime components running.

**Independent Test**: Seed database with MBTA GTFS static data via `GtfsStaticService`. Search for "Red Line" via `GET /api/v1/routes?q=Red`. Confirm stops list and departure times appear. Verify empty-state renders when no data is present. No Redis or realtime feed required.

### Backend — Routes

- [X] T032 [US1] Create `RoutesModule` in `backend/src/modules/routes/routes.module.ts` — declare `RoutesService`, `RoutesController`; import `CacheModule`, `TypeOrmModule.forFeature([Route, Shape])`
- [X] T033 [P] [US1] Implement `RoutesService` in `backend/src/modules/routes/routes.service.ts` — `findAll(agencyKey?, routeType?, q?, limit, offset)` using SQL ILIKE on `short_name` and `long_name` (FR-027); `findOne(routeId, agencyKey)` assembling shape GeoJSON LineString from ordered Shape points; cache-aside via `CacheService` (300 s TTL, key `cache:routes:{agencyKey}` / `cache:route:{agencyKey}:{routeId}`); on cache miss falls back to direct TypeORM query (FR-024)
- [X] T034 [P] [US1] Implement `RoutesController` in `backend/src/modules/routes/routes.controller.ts` — `GET /api/v1/routes` with query params `agencyKey`, `routeType`, `q`, `limit`, `offset`; `GET /api/v1/routes/:routeId` with required `agencyKey` query param; 404 on not found; responses match contracts/api.md shape (FR-017, FR-018)

### Backend — Stops

- [X] T035 [US1] Create `StopsModule` in `backend/src/modules/stops/stops.module.ts` — declare `StopsService`, `StopsController`; import `CacheModule`, `TypeOrmModule.forFeature([Stop, StopTime, Trip, Route])`
- [X] T036 [P] [US1] Implement `StopsService` in `backend/src/modules/stops/stops.service.ts` — `search(q, agencyKey?, limit, offset)` using ILIKE on `stop_name` and `stop_code` (FR-027); `getDepartures(stopId, agencyKey, limit, after)` joining `stop_times → trips → routes` filtered to today's active `service_id` via `service_calendars`, sorted by `departure_time`; cache-aside 20 s (FR-009, FR-024); `getRoutesForStop(stopId, agencyKey)` returning distinct routes
- [X] T037 [US1] Implement `StopsController` in `backend/src/modules/stops/stops.controller.ts` — `GET /api/v1/stops` (q required, ≥2 chars, 400 otherwise), `GET /api/v1/stops/:stopId/departures` (agencyKey required), `GET /api/v1/stops/:stopId/routes`; all responses match contracts/api.md (FR-017, FR-018)

### Backend — Trips & Agencies

- [X] T038 [P] [US1] Create `TripsModule` + `TripsController` in `backend/src/modules/trips/` — `GET /api/v1/trips/:tripId` (agencyKey required); `TripsService.findOne()` queries `trips JOIN stop_times JOIN stops` for ordered stop sequence; 404 on not found; cache 300 s
- [X] T039 [P] [US1] Add `AgenciesController` to `backend/src/modules/agencies/agencies.controller.ts` — `GET /api/v1/agencies` returns all agencies with `lastIngestedAt` and `hasRealtime` derived from whether `gtfsRealtimeUrl` is set

### Frontend — Foundation

- [X] T040 [US1] Create `frontend/src/lib/theme.ts` — `createTheme({palette: {primary: {main: '#DA291C'}, ...}, typography: {fontFamily: 'Inter, system-ui, sans-serif'}, spacing: 8})`; export `theme` constant
- [X] T041 [P] [US1] Create `frontend/src/app/layout.tsx` — root layout wrapping children in MUI `ThemeProvider` with `CssBaseline`; import `leaflet/dist/leaflet.css` for global Leaflet icon/tile styles (A-010)
- [X] T042 [P] [US1] Create `frontend/src/app/api/health/route.ts` — Next.js Route Handler: `GET` returns `Response.json({status:'ok'})` 200; used by Docker Compose frontend healthcheck (FR-021)
- [X] T043 [P] [US1] Create `frontend/src/lib/api-client.ts` — typed async fetch wrappers for all `/api/v1` endpoints: `fetchRoutes`, `fetchRoute`, `fetchStops`, `fetchStopDepartures`, `fetchStopRoutes`, `fetchTrip`, `fetchVehicles`, `fetchAlerts`, `fetchNearbyStops`, `fetchAgencies`; all return typed response or throw with structured error

### Frontend — Shared UI Components

- [X] T044 [P] [US1] Create `frontend/src/components/ui/LoadingSkeleton.tsx` — MUI `Skeleton` variant="rectangular" with configurable height and count props; used by all five data-driven views (FR-014)
- [X] T045 [P] [US1] Create `frontend/src/components/ui/EmptyState.tsx` — MUI `Box` + `Typography` + optional `Button`; props: `message`, `suggestion`, `onAction`; used for zero-results and empty-database states (FR-014, US1 AS4, US1 AS5)
- [X] T046 [P] [US1] Create `frontend/src/components/ui/AlertBanner.tsx` — MUI `Alert` with configurable `severity` and `action` prop for recovery suggestions; used for service alerts and error states (FR-013, Principle III)
- [X] T047 [P] [US1] Create `frontend/src/components/stops/StopCard.tsx` — MUI `Card` displaying stop name, stop code, distance (optional); `onClick` navigates to stop departures page
- [X] T048 [P] [US1] Create `frontend/src/components/stops/DepartureRow.tsx` — MUI `TableRow` displaying route short name, headsign, scheduled departure, realtime delay badge (MUI `Chip`); handles `hasRealtime: false` gracefully

### Frontend — Pages (US1)

- [X] T049 [US1] Create `frontend/src/app/page.tsx` — route search home page; MUI `TextField` with debounced input calling `fetchRoutes({q})`; MUI `List` of results; `LoadingSkeleton` while loading; `EmptyState` when no results or database empty (FR-014, US1 AS1, US1 AS4, US1 AS5)
- [X] T050 [US1] Create `frontend/src/app/(routes)/[routeId]/page.tsx` — route detail page; fetches route with stops and shape via `fetchRoute`; MUI `List` of stops sorted by sequence; each stop links to stop departures page; `LoadingSkeleton` and `EmptyState` per FR-014 (US1 AS1, US1 AS2)
- [X] T051 [P] [US1] Create `frontend/src/app/stops/page.tsx` — stop search page; same pattern as route search using `fetchStops({q})`; renders `StopCard` list; `EmptyState` on no results (US1 AS3)
- [X] T052 [US1] Create `frontend/src/app/stops/[stopId]/page.tsx` — stop departures page; fetches departures via `fetchStopDepartures` and routes via `fetchStopRoutes`; MUI `Table` of `DepartureRow` items; `LoadingSkeleton` and `EmptyState` per FR-014 (US1 AS2, US1 AS3)

**Checkpoint**: With no realtime services running, execute the Independent Test above. All five pages (home, route detail, stop search, stop departures, empty state) must render correctly via `docker compose up`.

---

## Phase 4: User Story 2 — Live Vehicle Position Tracking (Priority: P2)

**Goal**: An interactive OpenStreetMap map shows live vehicle positions that automatically refresh every 15 seconds. When the realtime feed is unavailable, a clearly visible notice is shown.

**Independent Test**: Run GtfsRealtimeService with fixture GTFS-RT protobuf data. Call `GET /api/v1/vehicles/live`. Confirm vehicle markers appear and update on the map page without any US1 features needing to be exercised.

### Backend — Realtime Ingestion

- [X] T053 [US2] Implement `GtfsRealtimeService` in `backend/src/modules/ingestion/gtfs-realtime.service.ts` — download protobuf feed with `node-fetch`; decode using `GtfsRealtimeBindings.FeedMessage.decode()`; extract `VehiclePosition`, `TripUpdate`, and `Alert` entities; filter VehiclePositions: fetch Set of valid `trip_id` values from DB for that agency, discard positions with unknown `tripId` (log WARN with vehicleId + tripId — FR-026); write surviving positions to `HSET vehicles:{agencyKey}` TTL 30 s and alerts to `alerts:{agencyKey}` TTL 30 s via ioredis pipeline (FR-007, FR-008)
- [X] T054 [US2] Add `@Interval(REALTIME_POLL_INTERVAL_MS)` method to `IngestionScheduler` in `backend/src/modules/ingestion/ingestion.scheduler.ts` calling `GtfsRealtimeService.pollAgency()` for each agency that has `gtfsRealtimeUrl` configured (FR-007)

### Backend — Vehicles & Alerts

- [X] T055 [P] [US2] Create `VehiclesModule` + `VehiclesController` in `backend/src/modules/vehicles/` — `GET /api/v1/vehicles/live` reads all fields from `HGET vehicles:{agencyKey}` or all agencies; returns `503` with `{error: 'Live tracking temporarily unavailable', statusCode: 503}` if Redis is unreachable (contract spec — vehicles have no DB fallback since positions exist only in Redis)
- [X] T056 [P] [US2] Create `AlertsModule` + `AlertsController` in `backend/src/modules/alerts/` — `GET /api/v1/alerts` reads `alerts:{agencyKey}` STRING JSON from Redis; supports `agencyKey`, `routeId`, `stopId` query filters applied in-process; returns empty `alerts: []` array if Redis key missing or unavailable (graceful degradation)

### Frontend — Polling Hook & Map

- [X] T057 [US2] Create `frontend/src/lib/hooks/usePolling.ts` — `usePolling<T>(intervalMs: number, fetcher: () => Promise<T>)` hook using `useEffect` + `setInterval` with proper cleanup; returns `{data: T | null, error: Error | null, isLoading: boolean, lastUpdatedAt: Date | null}`; used by map and nearby-stops pages (FR-023)
- [X] T058 [US2] Create `frontend/src/components/map/VehicleMap.tsx` — Leaflet `MapContainer` with OpenStreetMap `TileLayer`; `Marker` per vehicle with `Popup` showing route short name, next stop, `updatedAt` formatted timestamp; `Polyline` per route shape from static data (FR-012); "Live tracking is temporarily unavailable" MUI `Alert` overlay when vehicles endpoint returns error (US2 AS4); all vehicle and shape data passed as props from parent page
- [X] T059 [US2] Create `frontend/src/app/map/page.tsx` — imports `VehicleMap` via `next/dynamic({ssr: false})` (required for Leaflet); calls `usePolling(15000, fetchVehicles)` for vehicle positions (FR-023); calls `usePolling(30000, fetchAlerts)` for active alerts; renders `AlertBanner` for any active disruptions; shows "Live updates paused" MUI `Alert` if `lastUpdatedAt` is > 5 minutes stale (SC-007)

### Frontend — Alert Integration on Static Views

- [X] T060 [P] [US2] Add FR-013 alert display to `frontend/src/app/(routes)/[routeId]/page.tsx` — call `fetchAlerts({routeId})` alongside route data; render `AlertBanner` above stop list when alerts are present
- [X] T061 [P] [US2] Add FR-013 alert display to `frontend/src/app/stops/[stopId]/page.tsx` — call `fetchAlerts({stopId})` alongside departures; render `AlertBanner` above departure table when alerts are present

**Checkpoint**: Execute the Independent Test. Vehicle markers appear on map, update every 15 seconds without page refresh, and the "Live tracking temporarily unavailable" alert appears when the realtime service is stopped.

---

## Phase 5: User Story 3 — Nearby Stops Discovery (Priority: P3)

**Goal**: A rider can discover stops within walking distance (default 500 m) of their current location and view upcoming departures, with a graceful fallback when geolocation is denied.

**Independent Test**: Call `GET /api/v1/stops/nearby?lat=42.3601&lon=-71.0589&radius=500`. Confirm stops are returned sorted by `distanceMetres`. Open the nearby stops page with location permission denied and confirm the manual lat/lon input appears.

- [X] T062 [US3] Add `getNearbyStops(lat, lon, radiusM, agencyKey?, limit)` to `backend/src/modules/stops/stops.service.ts` — PostGIS query: `ST_DWithin(location, ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography, $radius)` with ordering by `ST_Distance` using `<->` KNN operator on the GiST index; returns `distanceMetres` computed by PostGIS; cache-aside 45 s key `cache:stops:nearby:{lat3dp}:{lon3dp}:{radius}` (FR-004, FR-015)
- [X] T063 [US3] Add `GET /api/v1/stops/nearby` to `backend/src/modules/stops/stops.controller.ts` — validate `lat` (-90–90) and `lon` (-180–180) present and in range (400 on violation); validate `radius` ≤ 5000 (400 on violation); returns `{data, searchCentre, radiusMetres}` per contracts/api.md (FR-004)
- [X] T064 [P] [US3] Update `frontend/src/lib/api-client.ts` — add typed `fetchNearbyStops(lat, lon, radius)` wrapper returning the nearby-stops response shape
- [X] T065 [US3] Create `frontend/src/app/stops/nearby/page.tsx` — call `navigator.geolocation.getCurrentPosition()` on mount; show MUI `CircularProgress` while waiting; on permission granted: call `fetchNearbyStops` and render `StopCard` list sorted by distance; on permission denied: render MUI `TextField` pair for manual lat/lon entry (US3 AS3); "No stops found nearby" `EmptyState` with MUI `Button` "Search wider area" that doubles `radius` state and re-fetches (US3 AS4); uses `usePolling(30000)` to refresh departure times per stop
- [X] T066 [P] [US3] Augment nearby stops response with next departure per stop — in `StopsService.getNearbyStops`, for each returned stop fetch the next scheduled departure (reuse `getDepartures` with `limit: 1`) and include in response; merge any available TripUpdate delay from Redis into the departure time (US3 AS2)

**Checkpoint**: Execute the Independent Test. Stops return sorted by distance. Manual lat/lon fallback works when geolocation is blocked.

---

## Phase 6: User Story 4 — Multi-Agency Plug-In Configuration (Priority: P4)

**Goal**: A system operator adds a second transit agency by editing `config/agencies.json` only — no code changes required. Both agencies' data appears side by side with no ID collisions.

**Independent Test**: Add a second publicly available GTFS feed to `config/agencies.json`. Run `GtfsStaticService.ingestAgency()`. Confirm routes and stops for both agencies appear in `GET /api/v1/routes` without either agency's data being altered.

- [X] T067 [US4] Validate multi-entry `config/agencies.json` support in `backend/src/modules/agencies/agencies.service.ts` — parse array of agency objects; validate all required fields per entry; `getAgencyByKey()` must handle two agencies with same numeric route/stop IDs without collision (composite key scoping — per spec Key Entities namespacing)
- [X] T068 [P] [US4] Verify per-agency data isolation in `GtfsStaticService` — confirm `QueryRunner` `DELETE WHERE agency_id = X` scopes strictly to the target agency UUID and does not touch other agencies' rows; add a second-agency ingestion in the test to assert row counts per agency (US4 AS2, AS3)
- [X] T069 [P] [US4] Verify `agencyKey` filter propagates end-to-end — `RoutesController`, `StopsController`, `VehiclesController`, `AlertsController` all accept and plumb `agencyKey` query param to service layer; `undefined` returns all-agency data (US4 AS2, contract spec)
- [X] T070 [P] [US4] Verify env var API key resolution — `AgenciesService` reads `process.env[entry.apiKeyEnvVar]`; log WARN if var is declared in config but not set at runtime; do not throw (allow agencies without keys to still function for public feeds — FR-016)
- [X] T071 [P] [US4] Update `quickstart.md` — add "Adding a second agency" section: edit `config/agencies.json`, set any required env var in `.env`, restart the worker container; document expected ingestion time for a 500K stop-time feed (SC-009)

**Checkpoint**: Two-agency setup passes the Independent Test. `GET /api/v1/agencies` lists both. Routes and stops for each agency are accessible via `agencyKey` filter.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validate all non-functional requirements, FR-based edge cases, and infrastructure correctness. No new features — hardening and verification only.

- [X] T072 Implement FR-026 trip_id validation in `backend/src/modules/ingestion/gtfs-realtime.service.ts` — before processing FeedMessage, query `SELECT trip_id FROM trips WHERE agency_id = $agencyId` into a `Set<string>`; filter vehicle positions against this Set; emit `Logger.warn('Discarding vehicle position — unknown trip_id', {vehicleId, tripId, agencyKey})` for each discarded entry
- [X] T073 [P] Verify NGINX 429 JSON response shape — confirm `nginx.conf` `error_page 429` location block returns `Content-Type: application/json` with body `{"error":"Rate limit exceeded","statusCode":429}`; verify response does not default to nginx HTML error page (FR-020)
- [X] T074 [P] Verify Docker Compose health check dependency chain — all six services in `docker-compose.yml` have `healthcheck` with `CMD`, `interval`, `timeout`, `retries`; `backend` and `worker` use `depends_on: db: condition: service_healthy` and `cache: condition: service_healthy`; `nginx` depends on `backend` and `frontend` healthy (FR-021, SC-002)
- [X] T075 [P] Add `jest-axe` accessibility assertions to frontend component tests — create test files for `LoadingSkeleton`, `EmptyState`, `AlertBanner`, `StopCard`, `DepartureRow` in `frontend/tests/unit/`; each test renders the component and calls `expect(await axe(container)).toHaveNoViolations()` (SC-008, Principle III)
- [X] T076 [P] Audit MUI named imports in all frontend component files — ensure all MUI imports use named sub-path style (e.g. `import Button from '@mui/material/Button'`) not barrel `import {Button} from '@mui/material'`; run `@next/bundle-analyzer` and verify initial chunk ≤ 150 KB gzipped (Principle IV)
- [X] T077 [P] Configure Jest coverage thresholds ≥ 80% in `backend/jest.config.ts` and `frontend/jest.config.ts` — `coverageThreshold: {global: {lines: 80, functions: 80, branches: 80}}` (Principle II)
- [X] T078 [P] Verify Redis cache fallback with unit test for `CacheService` in `backend/tests/unit/cache.service.spec.ts` — mock `ioredis` to throw `Error('Connection refused')`; assert `CacheService.get()` returns `null` without throwing; assert WARN log was emitted (FR-024)
- [X] T079 Verify single-command stack startup — run `docker compose build && docker compose up -d`; poll `docker compose ps` until all six containers show `healthy`; confirm `GET /health`, `GET /api/health`, and `GET /api/v1/agencies` all return 200 within 5 minutes (SC-002)

**Checkpoint**: All 27 FRs covered, all 10 SCs testable, all 4 principles satisfied. Stack starts cleanly from `docker compose up`.

---

## Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                              └──→ Phase 5 (US3 reuses StopsService from Phase 3)
                              └──→ Phase 6 (US4 validates infrastructure from Phases 2–3)
                              └──→ Phase 7 (polish; can start after any Phase 3 task is done)
```

| Story | Depends On |
|-------|-----------|
| US1 (Phase 3) | Phase 2 complete (all entities, ingestion, infrastructure) |
| US2 (Phase 4) | Phase 2 complete; api-client.ts and usePolling hook from Phase 3 |
| US3 (Phase 5) | Phase 3 StopsService (getNearbyStops extends it); api-client.ts from Phase 3 |
| US4 (Phase 6) | Phase 3 and Phase 4 functional; validates end-to-end multi-agency paths |
| Polish (Phase 7) | Can begin incrementally after any phase; T076–T079 require full stack |

**Independent stories**: US2, US3, and US4 phases do not depend on each other — they can be worked in parallel once Phase 3 is complete.

---

## Parallel Execution Examples

### US1 Backend + Frontend in parallel

```
Stream A (Backend):     T032 → T033+T034 → T035 → T036+T037 → T038+T039
Stream B (Frontend):    T040 → T041+T042+T043 → T044+T045+T046+T047+T048 → T049 → T050+T051+T052
```

### US2 Backend + Frontend in parallel (after T057 depends on Phase 3 api-client)

```
Stream A (Backend):     T053 → T054 → T055+T056
Stream B (Frontend):    T057 → T058 → T059 → T060+T061
```

### US3 Backend + Frontend in parallel

```
Stream A (Backend):     T062 → T063 → T066
Stream B (Frontend):    T064 → T065
```

### Entity creation (Phase 2, all parallelisable after T013)

```
T013 → T014+T015+T016+T017+T018+T019 (all in parallel after agencies entity is created)
```

---

## Summary

| Phase | User Story | Tasks | Parallel Opportunities |
|-------|-----------|-------|----------------------|
| Phase 1: Setup | — | T001–T012 (12) | T003, T004, T005, T007, T009, T012 |
| Phase 2: Foundational | — | T013–T031 (19) | T014–T019 entities; T022, T031 |
| Phase 3: US1 Route & Stop | P1 🎯 | T032–T052 (21) | T033+T034, T036, T038+T039, T041–T048, T051 |
| Phase 4: US2 Live Vehicles | P2 | T053–T061 (9) | T055+T056, T060+T061 |
| Phase 5: US3 Nearby Stops | P3 | T062–T066 (5) | T064+T066 |
| Phase 6: US4 Multi-Agency | P4 | T067–T071 (5) | T068, T069, T070, T071 |
| Phase 7: Polish | — | T072–T079 (8) | T073–T078 all parallel |
| **Total** | | **79 tasks** | **43 parallelisable** |

**MVP scope** (Phase 1 + 2 + 3 only — 52 tasks): Delivers a fully functional GTFS static schedule browser with route search, stop discovery, and departure boards. No realtime components required.
