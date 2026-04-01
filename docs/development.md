# Development Guide

## Prerequisites

| Tool           | Minimum Version | Install                             |
| -------------- | --------------- | ----------------------------------- |
| Docker Desktop | 25.x            | https://docs.docker.com/get-docker/ |
| Docker Compose | v2.x (plugin)   | Included with Docker Desktop        |
| Git            | any             | https://git-scm.com                 |

No language runtimes need to be installed on the host — everything runs inside containers.

---

## Initial Setup

### 1. Clone the repository

```sh
git clone <repository-url> transit-tracker
cd transit-tracker
```

### 2. Configure environment

```sh
cp .env.example .env
```

Open `.env` and fill in the required values:

```dotenv
# Required: strong password for PostgreSQL
POSTGRES_PASSWORD=changeme_strong_password

# Required: get a free key at https://api-v3.mbta.com/
MBTA_API_KEY=your_mbta_api_key_here
```

All other values have sensible defaults for local development. See [docs/configuration.md](configuration.md) for the full variable reference.

> `.env` is in `.gitignore` — never commit it.

### 3. Start the stack

```sh
docker compose up --build
```

First run downloads images, builds containers, initialises the database, and runs the initial GTFS ingest — expect **3–5 minutes**. Subsequent starts take under 30 seconds.

---

## Verify Services

Once all containers report `healthy`:

| URL                                                    | Description                  |
| ------------------------------------------------------ | ---------------------------- |
| `http://localhost`                                     | Frontend application         |
| `http://localhost/health`                              | NGINX + backend health check |
| `http://localhost/api/v1/agencies`                     | Lists ingested agencies      |
| `http://localhost/api/v1/routes?agencyKey=mbta`        | MBTA route list              |
| `http://localhost/api/v1/vehicles/live?agencyKey=mbta` | Live vehicle positions       |

Quick smoke test:

```sh
curl -s -o /dev/null -w "%{http_code}" http://localhost/health
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/agencies
curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/v1/routes?agencyKey=mbta"
```

All three should return `200`.

---

## Hot-Reload Development

Use the dev Compose overlay to mount source directories as volumes, so code changes reload without rebuilding images:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

| Service  | Dev URL                 | Hot reload                 |
| -------- | ----------------------- | -------------------------- |
| Frontend | `http://localhost:3001` | Yes — Next.js fast refresh |
| Backend  | `http://localhost:3000` | Yes — NestJS watch mode    |
| Postgres | `localhost:5432`        | N/A                        |
| Redis    | `localhost:6379`        | N/A                        |

The NGINX proxy on port 8080 is still available in dev mode and routes normally.

---

## Running Tests

All test commands run inside the containers against the live database and Redis (integration tests) or in isolation (unit tests).

```sh
# Backend: all tests
docker compose exec backend npm test

# Backend: contract tests only
docker compose exec backend npm run test:contract

# Backend: coverage report (must be ≥ 80%)
docker compose exec backend npm run test:cov

# Frontend: unit tests
docker compose exec frontend npm test
```

### Root quality-gate commands

Run these commands from repository root to mirror CI gate behavior:

```sh
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

### Repository-wide alias policy

- Both `backend` and `frontend` are in scope for alias-policy validation.
- Use `@/` imports for module paths covered by each project's `tsconfig.json` alias mapping.
- Deep relative imports (`../../` and deeper) are treated as alias-policy violations in lint checks.

Expected behavior:

- `npm run typecheck` runs backend and frontend type diagnostics and reports all project errors before failing.

Interactive Cypress debugging from root:

```sh
npm run dev
npm run test:e2e:open
```

### Required CI check names (branch protection)

Configure branch protection to require the following checks:

- `lint`
- `typecheck`
- `unit`
- `integration`
- `contract`
- `accessibility`
- `performance`
- `peer-review-validation`
- `cypress-map`
- `cypress-stops`
- `cypress-routes`
- `cypress-core-smoke`

Merge readiness requires all checks to pass and at least one non-author approval.

### Gate failure semantics

- Any required check failure blocks merge.
- Cypress jobs fail if a group discovers zero tests.
- Cypress flow also fails when total scenarios across groups drops below 12.
- Unit gate fails on coverage floor breach (backend >= 85%, frontend >= 80%) or baseline regression when baselines are provided.

### Pre-commit and formatter interoperability troubleshooting

- Pre-commit hook executes `npm run format:check` and `lint-staged`.
- If hook exits with `command not found: lint-staged`, run `npm ci` at repository root.
- If ESLint reports formatting conflicts, ensure backend and frontend ESLint configs extend `prettier`.
- If Prettier checks fail on generated files, verify `.prettierignore` includes those paths.
- To auto-fix staged files before retrying commit: `npx lint-staged`.

### SC-003 contributor validation protocol

For a release candidate, sample at least 10 contributors and capture local execution timings:

| Contributor | Date | `npm run test:unit` | `npm run test:e2e` | `npm run test:e2e:open` preflight | Notes |
| ----------- | ---- | ------------------- | ------------------ | --------------------------------- | ----- |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |
|             |      |                     |                    |                                   |       |

Record command output snippets and blockers in `specs/002-test-automation-ci/research.md`.

### Test structure

| Path                                | Type                               |
| ----------------------------------- | ---------------------------------- |
| `backend/src/**/*.spec.ts`          | Unit tests                         |
| `backend/src/**/*.contract.spec.ts` | Contract tests (match API schemas) |
| `backend/test/**`                   | Integration / e2e tests            |
| `frontend/src/**/*.test.tsx`        | Frontend component tests           |

---

## Adding a Transit Agency

1. **Edit `config/agencies.json`** — append an entry:

   ```json
   {
     "key": "trimet",
     "displayName": "TriMet",
     "timezone": "America/Los_Angeles",
     "gtfsStaticUrl": "https://developer.trimet.org/schedule/gtfs.zip",
     "gtfsRealtimeUrl": null,
     "apiKeyEnvVar": null
   }
   ```

   See [docs/configuration.md](configuration.md#agency-configuration-configagenciesjson) for field descriptions.

2. **Add an API key to `.env`** if the agency requires one:

   ```dotenv
   TRIMET_API_KEY=your_key_here
   ```

   Leave the value blank or omit the variable if the feed is public.

3. **Restart the worker** to pick up the new config:

   ```sh
   docker compose restart worker
   ```

   The worker ingests all listed agencies on the next scheduled cron run. To trigger immediately:

   ```sh
   docker compose exec worker node dist/worker.js --run-now
   ```

No code changes and no image rebuild needed — the worker reads `agencies.json` at startup.

---

## Stopping and Resetting

```sh
# Stop containers — data is preserved
docker compose down

# Full reset — remove containers and all data volumes
docker compose down -v

# Rebuild images after changing dependencies
docker compose up --build
```

---

## Project Structure

```
transit-tracker/
├── frontend/           Next.js 14 app (pages, components, hooks, styles)
├── backend/
│   └── src/
│       ├── agencies/   Agency REST module
│       ├── routes/     Routes REST module
│       ├── stops/      Stops + nearby + departures modules
│       ├── trips/      Trips REST module
│       ├── vehicles/   Live vehicles module
│       ├── alerts/     Service alerts module
│       ├── worker/     GTFS ingestion worker (cron + realtime)
│       ├── database/   TypeORM entities and migration setup
│       ├── redis/      Redis client module
│       └── common/     Shared constants, guards, interceptors
├── config/
│   └── agencies.json   Agency list (edit to add/remove agencies)
├── docker/             Per-service Dockerfiles
├── docs/               User-facing documentation (you are here)
├── specs/              SpecKit feature specs (internal planning artifacts)
├── nginx.conf          NGINX reverse proxy configuration
├── docker-compose.yml  Production Compose file
└── docker-compose.dev.yml  Dev overlay (volume mounts + port bindings)
```

---

## Troubleshooting

| Symptom                                          | Likely cause                          | Fix                                                                                                           |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `transit-backend` exits with `ECONNREFUSED`      | Postgres not ready yet                | Wait 30 s; health check retries automatically                                                                 |
| Worker logs "feed download failed"               | Invalid URL or missing API key        | Check `.env`; verify the URL is reachable from inside the container (`docker compose exec worker curl <url>`) |
| Frontend shows "No data available yet"           | Ingestion hasn't finished             | Check `docker compose logs worker` and wait for the ingest to complete                                        |
| HTTP 429 from `/api/`                            | Rate limit hit                        | Slow down requests; limit is 1 req/s sustained, burst 10 per IP                                               |
| Map shows no vehicle markers                     | Realtime feed disabled or unreachable | Check `gtfsRealtimeUrl` in `config/agencies.json`; check worker logs                                          |
| `docker compose up` fails on `permission denied` | Docker socket not accessible          | Ensure Docker Desktop is running and your user is in the `docker` group                                       |
