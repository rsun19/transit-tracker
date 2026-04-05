# Transit Tracker

A config-driven, multi-agency GTFS transit tracking platform delivered as a single `docker compose up` command.

Ingest GTFS static and realtime feeds from any transit agency, then browse routes, stop departures, nearby stops, and a live vehicle map — all in one web interface.

Built with **Next.js 14**, **NestJS 10**, **PostgreSQL + PostGIS**, **Redis**, and **NGINX**. Adding a new transit agency requires only a single JSON config entry — no code changes.

---

## Features

- **Route search** — full-text search across all routes with route-type filtering
- **Stop departures** — scheduled departures with realtime delay augmentation from GTFS-RT
- **Nearby stops** — PostGIS KNN query within a configurable radius; geolocation or manual coordinates
- **Live vehicle map** — Leaflet map with vehicle positions polled every 15 s from GTFS-RT
- **Service alerts** — GTFS-RT alert banners on all relevant pages
- **Multi-agency** — add any GTFS-compatible agency via `config/agencies.json`

---

## Quick Start

**Prerequisites**: Docker Desktop 25+, Docker Compose v2, Git

```bash
git clone <repository-url> transit-tracker
cd transit-tracker
cp .env.example .env          # fill in POSTGRES_PASSWORD + MBTA_API_KEY
docker compose up --build
```

Open **http://localhost** once all containers are healthy (~3–5 min on first run).

> Get a free MBTA API key at https://api-v3.mbta.com/

### Development (hot reload)

Use `docker-compose.dev.yml` for local development — source files are mounted as volumes so changes reload automatically without rebuilding:

```bash
docker-compose -f docker-compose.dev.yml up --build
```

- **Backend** restarts on file changes via NestJS watch mode
- **Frontend** uses Next.js Fast Refresh
- **Worker** restarts on file changes

See [docs/development.md](docs/development.md) for the full setup guide, dev workflow, and troubleshooting.

### Root Quality Gates

Run the full CI-equivalent suite locally from repository root:

```bash
npm run lint
npm run typecheck
npm run format:check
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:a11y
npm run test:performance
npm run test:e2e
```

`npm run typecheck` is the canonical repository-wide TypeScript diagnostics command used both locally and in CI.

Interactive Cypress workflow:

```bash
npm run dev
npm run test:e2e:open
```

Single entrypoint for all constitution-automatable gates:

```bash
npm test
```

---

## Deployment (Hetzner + GitHub Actions CD)

Merges to `main` automatically build and push Docker images to GHCR, then SSH to the Hetzner server and restart the stack.

### GitHub Actions Secrets

Set these under **Settings → Secrets and variables → Actions → Repository secrets** in your GitHub repository:

| Secret            | Description                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| `HETZNER_HOST`    | Public IP address of the Hetzner server                                        |
| `HETZNER_USER`    | SSH username (e.g. `root`)                                                     |
| `SSH_PRIVATE_KEY` | Private SSH key whose public half is in `~/.ssh/authorized_keys` on the server |
| `CERTBOT_EMAIL`   | Email address for Let's Encrypt certificate expiry notices                     |

### Server `.env` variables

The production `.env` at `/opt/transit-tracker/.env` on the server must contain all variables from `.env.example` plus these which CI injects automatically:

| Variable            | Set by | Description                                                   |
| ------------------- | ------ | ------------------------------------------------------------- |
| `POSTGRES_USER`     | You    | PostgreSQL username                                           |
| `POSTGRES_PASSWORD` | You    | PostgreSQL password — use a strong random value in production |
| `POSTGRES_DB`       | You    | PostgreSQL database name                                      |
| `IMAGE_TAG`         | CI     | Git SHA of the deployed commit                                |
| `REGISTRY_OWNER`    | CI     | GitHub repository owner (used to pull images from GHCR)       |

### First deploy

Point your domain's DNS A record to the Hetzner server IP before the first push to `main`. The deploy script detects the absence of a TLS certificate and bootstraps it automatically via Let's Encrypt before starting nginx.

---

## Documentation

| Doc                                            | Contents                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | System design, service topology, data flow, tech stack        |
| [docs/api-reference.md](docs/api-reference.md) | Full REST API endpoint reference with request/response shapes |
| [docs/data-model.md](docs/data-model.md)       | PostgreSQL schema, Redis key design, entity relationships     |
| [docs/configuration.md](docs/configuration.md) | Environment variables, agency config, NGINX/Docker tuning     |
| [docs/development.md](docs/development.md)     | Local setup, hot-reload workflow, testing, troubleshooting    |
| [docs/deployment.md](docs/deployment.md)       | CD pipeline, first deploy, TLS bootstrap, troubleshooting     |

---

## Stack

| Layer            | Technology                                            |
| ---------------- | ----------------------------------------------------- |
| Frontend         | Next.js 14, MUI v6, react-leaflet, TypeScript         |
| Backend API      | NestJS 10, TypeORM 0.3, TypeScript                    |
| Ingestion worker | NestJS standalone, csv-parser, gtfs-realtime-bindings |
| Database         | PostgreSQL 16 + PostGIS 3.4                           |
| Cache            | Redis 7                                               |
| Proxy            | NGINX 1.27 (rate limiting, routing)                   |
| Containers       | Docker Compose (6-service stack)                      |

---

## Project Layout

```
frontend/          Next.js app (pages, components, api-client)
backend/           NestJS API server + ingestion worker (shared codebase)
config/            Agency configuration (agencies.json)
docker/            Database init SQL
docs/              Project documentation
specs/             Feature specs, plans, and task lists (SpecKit)
nginx.conf         Reverse proxy configuration
docker-compose.yml Production/preview stack
.env.example       Environment variable template
```

---
