# transit-tracker Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies

- TypeScript 5.3, Node.js 20 LTS (all services) + Next.js 14 (frontend), NestJS 10 (backend + worker), TypeORM 0.3 + pg (database ORM), ioredis 5 (Redis client), @googletag/gtfs-realtime-bindings 0.0.9 (GTFS-RT protobuf), csv-parser (GTFS static CSV parsing), react-leaflet 4.2 + leaflet 1.9 (map), @nestjs/schedule (worker cron), node-fetch (feed HTTP downloads) (001-gtfs-dockerized-app)
- PostgreSQL 16 + PostGIS 3.4 (static GTFS source of truth), Redis 7 (realtime vehicle positions + API response cache) (001-gtfs-dockerized-app)
- TypeScript 5.3, Node.js 20 LTS (all services) + Next.js 14 (frontend), NestJS 10 (backend + worker), TypeORM 0.3 + pg (database ORM), ioredis 5 (Redis client), @googletag/gtfs-realtime-bindings 0.0.9 (GTFS-RT protobuf), csv-parser (GTFS static CSV parsing), @mui/material 6 + @mui/icons-material 6 (UI component library), react-leaflet 4.2 + leaflet 1.9 (map), @nestjs/schedule (worker cron), node-fetch (feed HTTP downloads) (001-gtfs-dockerized-app)
- TypeScript 5.3, Node.js 20 LTS + NestJS 10 + Jest 29 (backend tests), Next.js 14 + Jest 29 + Testing Library (frontend tests), Cypress 13 (new), GitHub Actions (new CI orchestration) (002-test-automation-ci)
- N/A (this feature primarily modifies test automation and CI orchestration) (002-test-automation-ci)
- TypeScript 5.x on Node.js 20+ (backend NestJS 10, frontend Next.js 14) + NestJS, Next.js, Jest, ESLint, Prettier, Cypress (planned for e2e), jest-axe, GitHub Actions (002-test-automation-ci)
- PostgreSQL 16 + PostGIS, Redis 7, repository files for CI/report artifacts (002-test-automation-ci)

- (001-gtfs-dockerized-app)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for

## Code Style

: Follow standard conventions

## Recent Changes

- 002-test-automation-ci: Added TypeScript 5.x on Node.js 20+ (backend NestJS 10, frontend Next.js 14) + NestJS, Next.js, Jest, ESLint, Prettier, Cypress (planned for e2e), jest-axe, GitHub Actions
- 002-test-automation-ci: Added TypeScript 5.3, Node.js 20 LTS + NestJS 10 + Jest 29 (backend tests), Next.js 14 + Jest 29 + Testing Library (frontend tests), Cypress 13 (new), GitHub Actions (new CI orchestration)
- 001-gtfs-dockerized-app: Added TypeScript 5.3, Node.js 20 LTS (all services) + Next.js 14 (frontend), NestJS 10 (backend + worker), TypeORM 0.3 + pg (database ORM), ioredis 5 (Redis client), @googletag/gtfs-realtime-bindings 0.0.9 (GTFS-RT protobuf), csv-parser (GTFS static CSV parsing), @mui/material 6 + @mui/icons-material 6 (UI component library), react-leaflet 4.2 + leaflet 1.9 (map), @nestjs/schedule (worker cron), node-fetch (feed HTTP downloads)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
