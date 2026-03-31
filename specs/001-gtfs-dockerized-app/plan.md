# Implementation Plan: GTFS Transit Tracker Web Application

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-gtfs-dockerized-app/spec.md`

## Summary

Build a scalable, config-driven, multi-agency GTFS transit tracking platform delivered as a Docker Compose stack. The platform ingests GTFS static ZIP feeds into PostgreSQL+PostGIS and GTFS Realtime protobuf feeds into Redis, then serves a unified REST API (NestJS) consumed by a Next.js frontend that renders an OpenStreetMap-based live vehicle map, stop departure boards, and route/stop search. Adding a new transit agency requires only a configuration file entry — no code changes.

## Technical Context

**Language/Version**: TypeScript 5.3, Node.js 20 LTS (all services)  
**Primary Dependencies**: Next.js 14 (frontend), NestJS 10 (backend + worker), TypeORM 0.3 + pg (database ORM), ioredis 5 (Redis client), @googletag/gtfs-realtime-bindings 0.0.9 (GTFS-RT protobuf), csv-parser (GTFS static CSV parsing), @mui/material 6 + @mui/icons-material 6 (UI component library), react-leaflet 4.2 + leaflet 1.9 (map), @nestjs/schedule (worker cron), node-fetch (feed HTTP downloads)  
**Storage**: PostgreSQL 16 + PostGIS 3.4 (static GTFS source of truth), Redis 7 (realtime vehicle positions + API response cache)  
**Testing**: Jest 29 (unit + integration), Supertest (API contract tests), React Testing Library (frontend), jest-axe (accessibility unit tests)  
**Target Platform**: Docker Compose on Linux (macOS development host), nginx:1.27-alpine reverse proxy  
**Project Type**: Multi-service web application (frontend + backend API + background worker)  
**Performance Goals**: API p95 ≤ 200 ms server-side; initial page load p95 ≤ 3 s; client bundle initial chunk ≤ 150 KB gzipped; realtime feed processing latency ≤ 5 s (server-side); end-to-end vehicle position staleness ≤ 30 s  
**Constraints**: 500 concurrent users; WCAG 2.1 AA; NGINX per-IP rate limit 60 req/min; all API keys via environment variables  
**Scale/Scope**: 10–20 routes typical; MBTA has ~214 routes, ~9,000 stops, ~500K stop-times; multi-agency extensible by config

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

### Principle I — Code Quality ✅ PASS

- TypeScript strict mode (`strict: true`) enforced in all packages via shared `tsconfig.base.json`
- ESLint + Prettier configured workspace-wide; zero-warning policy enforced in CI
- NestJS module structure (one module per domain) enforces single-responsibility at the framework level
- All feed URLs, TTL values, and polling intervals declared as named constants in `config/` — no magic values in service code
- Dependency audit: `@googletag/gtfs-realtime-bindings` is the official Google package; no duplication of stdlib fetch (node-fetch only for Node 18 compatibility with older Docker images)

### Principle II — Testing Standards ✅ PASS

- Test-first: acceptance scenarios in spec.md are the source for test cases written before implementation
- ≥ 80% coverage enforced via Jest `--coverageThreshold` in all packages
- Unit tests: GTFS CSV parser utilities, cache-aside logic, coordinate validation, protobuf extraction functions
- Integration tests: ingestion pipeline against Docker Compose test database (TypeORM test fixtures), API endpoint integration via Supertest
- Contract tests: API response schema snapshot tests via Jest + JSON schema; run in every CI build
- Accessibility: `jest-axe` assertions in frontend component tests; axe-core in playwright E2E

### Principle III — UX Consistency ✅ PASS

- MUI `createTheme` defines the design system (palette, typography scale, spacing, breakpoints); all components receive the theme via `ThemeProvider` — no hardcoded hex/px values in components
- All five views (search, route detail, stop detail, nearby stops, live map) use MUI `Skeleton` for loading states and a shared `EmptyState` component built on MUI `Box` + `Typography`
- WCAG 2.1 AA: MUI components ship with ARIA attributes; `jest-axe` assertions in unit tests and axe-playwright in E2E CI scans cover any custom overrides; violations are blocking
- Every error state includes a human-readable message via MUI `Alert` with an `action` prop for suggested recovery; no generic "Something went wrong"
- Uniform polling interaction: all realtime-updating views use the same `usePolling(interval, fetcher)` hook for consistency
- Leaflet CSS (`leaflet/dist/leaflet.css`) is imported globally for map rendering; all non-map UI uses MUI exclusively

### Principle IV — Performance ✅ PASS (with documented exception)

- PostGIS GiST spatial index on `stops.location` ensures KNN + `ST_DWithin` queries ≤ 50 ms at 9,000-stop scale
- Redis cache-aside keeps departure and nearby-stop API responses < 5 ms after first miss
- Next.js code splitting: Leaflet and react-leaflet loaded via `next/dynamic` with `ssr: false` — map page bundle excluded from initial chunk
- Initial chunk (search page): MUI v6 (named imports only, tree-shaken via `@mui/material/Button` style imports), React core, Next.js router ≈ 130–150 KB gzipped — at the 150 KB budget boundary; discipline over named imports is required to stay within budget

**Performance exception logged** (see Complexity Tracking):  
The constitution's "real-time data refresh ≤ 5 s from feed update" applies to server-side processing latency (feed received → Redis written), which this design meets (protobuf decode + Redis HSET pipeline ≤ 2 s). End-to-end client staleness is ≤ 30 s (SC-004 in spec), driven by a 15-second server-side poll + 15-second client poll. The 30-second end-to-end bound is the standard for GTFS Realtime polling deployments and is explicitly accepted in the spec.

## Project Structure

### Documentation (this feature)

```text
specs/001-gtfs-dockerized-app/
├── plan.md              # This file
├── research.md          # Phase 0 research decisions
├── data-model.md        # Entity schema + Redis key design
├── quickstart.md        # Setup and operational guide
├── contracts/
│   └── api.md           # REST API endpoint contracts
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── app/                    # Next.js 14 App Router pages
│   │   ├── (routes)/
│   │   │   ├── page.tsx        # Route search (US1 — P1)
│   │   │   └── [routeId]/
│   │   │       └── page.tsx    # Route detail
│   │   ├── stops/
│   │   │   ├── page.tsx        # Stop search
│   │   │   ├── [stopId]/
│   │   │   │   └── page.tsx    # Stop departures
│   │   │   └── nearby/
│   │   │       └── page.tsx    # Nearby stops (US3 — P3)
│   │   ├── map/
│   │   │   └── page.tsx        # Live map (US2 — P2)
│   │   ├── layout.tsx
│   │   └── globals.css         # Leaflet CSS import + minimal global resets (MUI handles all other styling)
│   ├── components/
│   │   ├── map/
│   │   │   └── VehicleMap.tsx  # Leaflet component (dynamic import target)
│   │   ├── ui/
│   │   │   ├── LoadingSkeleton.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── AlertBanner.tsx
│   │   └── stops/
│   │       ├── StopCard.tsx
│   │       └── DepartureRow.tsx
│   ├── lib/
│   │   ├── api-client.ts       # Typed fetch wrappers for all /api/v1 endpoints│       ├── theme.ts            # MUI createTheme — palette, typography, spacing│   │   └── hooks/
│   │       └── usePolling.ts   # Shared polling hook (US2, US3)
│   └── api/
│       └── health/
│           └── route.ts        # Next.js Route Handler: GET /api/health
├── tests/
│   ├── unit/
│   └── e2e/
├── next.config.ts
├── tsconfig.json
├── package.json
└── Dockerfile

backend/
├── src/
│   ├── modules/
│   │   ├── agencies/           # Agency CRUD + config loader
│   │   ├── routes/             # GET /api/v1/routes, /api/v1/routes/:id
│   │   ├── stops/              # GET /api/v1/stops, /nearby, /:id/departures
│   │   ├── trips/              # GET /api/v1/trips/:id
│   │   ├── vehicles/           # GET /api/v1/vehicles/live (Redis read)
│   │   ├── alerts/             # GET /api/v1/alerts (Redis read)
│   │   ├── ingestion/          # GTFS static + realtime ingestion services
│   │   │   ├── gtfs-static.service.ts
│   │   │   ├── gtfs-realtime.service.ts
│   │   │   └── ingestion.scheduler.ts  # @nestjs/schedule cron
│   │   ├── health/             # GET /health
│   │   └── cache/              # Cache-aside helper service (Redis)
│   ├── common/
│   │   ├── constants.ts        # All named config constants
│   │   └── filters/
│   │       └── http-exception.filter.ts
│   ├── config/
│   │   └── configuration.ts    # @nestjs/config typed configuration
│   ├── main.ts                 # API entry point (port 3000)
│   └── worker.ts               # Worker entry point (NestJS standalone app)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── contract/
├── tsconfig.json
├── package.json
├── Dockerfile                  # API container
└── Dockerfile.worker           # Worker container

config/
└── agencies.json               # Plug-in agency configuration (no code required)

docker/
└── init-db.sql                 # PostGIS extension + initial schema bootstrap

nginx.conf                      # NGINX reverse proxy + rate limiting
docker-compose.yml              # Production/preview stack
docker-compose.dev.yml          # Dev override (volume mounts, hot reload)
.env.example                    # Environment variable template
```

**Structure Decision**: Multi-service web application layout. `frontend/` (Next.js) and `backend/` (NestJS, shared by API and worker via separate entry points) are the two primary packages. `config/agencies.json` is the plug-in configuration file for transit agencies. `docker/` holds infrastructure initialization files. Single `backend/` package covers both the API server and the ingestion worker to share entity models, ingestion services, and the TypeORM connection without duplicating code.

## Complexity Tracking

| Violation                                                                                           | Why Needed                                                                                                                                                                                                                        | Simpler Alternative Rejected Because                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constitution Principle IV: "real-time data refresh ≤ 5 s" vs. 30-second end-to-end client staleness | GTFS-RT feeds are themselves updated every 15–30 seconds at the provider level (MBTA spec); WebSocket push would require a stateful connection manager and is explicitly out of scope; polling is the only compliant architecture | WebSocket push is listed as Out of Scope in spec.md; reducing poll interval below 15 s would violate MBTA's API usage guidelines and increase infra cost disproportionately |
