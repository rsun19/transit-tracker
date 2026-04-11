# Quickstart: GTFS Transit Tracker

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28

This guide gets the full application stack running locally from a clean machine using a single command.

---

## Prerequisites

| Tool           | Minimum Version | Install                             |
| -------------- | --------------- | ----------------------------------- |
| Docker Desktop | 25.x            | https://docs.docker.com/get-docker/ |
| Docker Compose | v2.x (plugin)   | Included with Docker Desktop        |
| Git            | any             | https://git-scm.com                 |

No language runtimes (Node.js, Python, etc.) need to be installed on the host — everything runs inside containers.

---

## 1. Clone & Configure

```bash
git clone <repository-url> transit-tracker
cd transit-tracker
```

Copy the environment template:

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```dotenv
# Database
POSTGRES_PASSWORD=changeme_strong_password_here

# MBTA API key (get one free at https://api-v3.mbta.com/)
MBTA_API_KEY=your_mbta_api_key_here

# Optional: override default GTFS feed URLs (leave blank to use defaults)
MBTA_GTFS_STATIC_URL=
MBTA_GTFS_REALTIME_URL=
```

**Security note**: Never commit `.env` to version control. It is already listed in `.gitignore`.

---

## 2. Start the Stack

```bash
docker compose up --build
```

Docker Compose starts all services in dependency order:

```
postgres (healthy)
    └── redis (healthy)
            └── backend (healthy) ──────── worker
                    └── frontend (healthy)
                              └── nginx
```

Expected output on first run:

```
transit-postgres  | database system is ready to accept connections
transit-redis     | Ready to accept connections tcp
transit-backend   | Application listening on port 3000
transit-frontend  | ready - started server on 0.0.0.0:3000
transit-worker    | [IngestionWorker] Starting GTFS ingestion for mbta...
transit-nginx     | Starting nginx...
```

First startup takes **3–5 minutes** (image builds + database initialization + initial GTFS ingestion). Subsequent starts take under 30 seconds.

---

## 3. Verify Services

Once all containers are healthy:

| URL                                                    | Description                           |
| ------------------------------------------------------ | ------------------------------------- |
| `http://localhost`                                     | Frontend application                  |
| `http://localhost/api/v1/agencies`                     | Backend API — lists ingested agencies |
| `http://localhost/api/v1/routes?agencyKey=mbta`        | MBTA routes                           |
| `http://localhost/api/v1/vehicles/live?agencyKey=mbta` | Live vehicle positions                |
| `http://localhost/health`                              | NGINX health check                    |

Quick smoke test:

```bash
# All three should return HTTP 200
curl -s -o /dev/null -w "%{http_code}" http://localhost/health
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/agencies
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/routes?agencyKey=mbta
```

---

## 4. Adding a Second Agency (Multi-Agency Setup)

> **Expected ingestion time**: A feed with ~500 000 stop-times takes approximately **3–6 minutes** on first ingest (database writes are batched in 1 000-row INSERT chunks within a SERIALIZABLE transaction). Subsequent ingests that do not change data complete in under 60 seconds due to the DELETE-then-INSERT being scoped to the agency UUID; no other agency's rows are touched. (SC-009)

**Step 1 — Edit `config/agencies.json`** at the repository root:

```json
[
  {
    "agencyKey": "mbta",
    "displayName": "MBTA",
    "timezone": "America/New_York",
    "gtfsStaticUrl": "https://cdn.mbta.com/MBTA_GTFS.zip",
    "gtfsRealtimeVehiclePositionsUrl": "https://cdn.mbta.com/realtime/VehiclePositions.pb",
    "apiKeyEnvVar": "MBTA_API_KEY"
  },
  {
    "agencyKey": "trimet",
    "displayName": "TriMet",
    "timezone": "America/Los_Angeles",
    "gtfsStaticUrl": "https://developer.trimet.org/schedule/gtfs.zip",
    "gtfsRealtimeVehiclePositionsUrl": null,
    "apiKeyEnvVar": null
  }
]
```

Add the corresponding environment variable to `.env` if the agency requires an API key:

```dotenv
TRIMET_API_KEY=    # blank = no key required
```

Then trigger re-ingestion (the worker runs automatically on schedule; to trigger manually):

```bash
docker compose exec worker node dist/worker.js --run-now
```

**Step 2 — Set any required environment variable in `.env`:**

```dotenv
TRIMET_API_KEY=    # blank = no key required for public feeds
```

**Step 3 — Restart the worker container** (no image rebuild needed):

```bash
docker compose restart worker
```

The worker picks up `config/agencies.json` on each restart and schedules ingestion for all listed agencies. Data for each agency is scoped by a unique `agency_id` UUID — route IDs, stop IDs, and trip IDs from different agencies never collide, even if the raw GTFS values are identical. (US4 AS2, AS3)

No code changes. No container rebuild.

---

## 5. Development Workflow

For local development with hot reload, use the dev profile:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts source directories as volumes so code changes reload without rebuilding images.

| Service  | Dev URL                 | Hot reload                 |
| -------- | ----------------------- | -------------------------- |
| Frontend | `http://localhost:3001` | Yes (Next.js fast refresh) |
| Backend  | `http://localhost:3000` | Yes (NestJS watch mode)    |
| Postgres | `localhost:5432`        | N/A                        |
| Redis    | `localhost:6379`        | N/A                        |

---

## 6. Running Tests

```bash
# Backend: unit + integration
docker compose exec backend npm test

# Backend: contract tests only
docker compose exec backend npm run test:contract

# Frontend: unit tests
docker compose exec frontend npm test

# Backend: coverage report
docker compose exec backend npm run test:cov
```

All test suites must pass at ≥80% coverage before any PR is merged.

---

## 7. Stopping & Resetting

```bash
# Stop all containers (data preserved)
docker compose down

# Stop and remove all data volumes (full reset)
docker compose down -v

# Rebuild images after dependency changes
docker compose up --build
```

---

## Troubleshooting

| Symptom                                      | Likely Cause                                    | Fix                                                                                   |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `transit-backend` exits with `ECONNREFUSED`  | Postgres not ready                              | Wait 30 s; health check retries automatically                                         |
| `transit-worker` logs "feed download failed" | Invalid GTFS URL or missing API key             | Check `.env`; verify URL is reachable from container                                  |
| Frontend shows "No data available yet"       | Ingestion hasn't completed                      | Wait for worker to finish (check `docker compose logs worker`)                        |
| HTTP 429 from API                            | Rate limit hit                                  | Slow down requests; limit is 60/min per IP                                            |
| Map shows no vehicle markers                 | Realtime feed off or agency has no realtime URL | Check `config/agencies.json` for `gtfsRealtimeVehiclePositionsUrl`; check worker logs |
