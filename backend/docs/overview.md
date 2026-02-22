# Backend Overview (AI Agent Guide)

This document is a quick orientation guide for AI agents making changes under `backend/`.

## Scope

The backend is a Django/ASGI service focused on MBTA alert ingestion and streaming.

Primary goals:
- Fetch MBTA alerts via REST (`/alerts/`)
- Stream transformed alert data via SSE (`/alerts/stream/`)
- Maintain one upstream MBTA stream and fan out updates to clients via Redis pub/sub

`/alerts/stream/` supports optional per-client route filtering via query params:
- `route_ids` (repeatable or comma-separated)
- `routes` (alias; repeatable or comma-separated)

Examples:
- `/alerts/stream/?route_ids=Red,Orange`
- `/alerts/stream/?route_ids=Red&route_ids=Orange`
- `/alerts/stream/?routes=Blue`

## Key Directories

- `mbta-server/mbta/`
  - Django project settings and URL routing.
- `mbta-server/alerts/`
  - Alerts app (views, worker command, stream logic, tests, constants).
- `mbta-server/streaming/`
  - Shared streaming primitives reusable across future packages/apps.

## Important Runtime Components

- **ASGI App** (`uvicorn mbta.asgi:application`)
  - Serves HTTP and SSE endpoints.
- **Background Worker** (`python manage.py mbta_alerts_worker`)
  - Maintains MBTA upstream stream and keeps active alert state in Redis.
  - Applies MBTA stream semantics (`reset`, `add`, `update`, `remove`) to active state.
  - Publishes latest full snapshot to Redis channel (`mbta:alerts`) and snapshot key for replay-on-connect.
- **Redis Broker**
  - Decouples upstream ingestion from downstream fan-out.

## Environment Variables

- `MBTA_KEY` (required for real MBTA data)
- `REDIS_URL` (defaults to `redis://localhost:6379/0`)

## Development Commands

From repo root:
- `make install-all`
- `make test`
- `make start-all` (Docker compose dev stack)
- `make stop-all`

## Agent Expectations

- Keep changes focused and minimal.
- Preserve existing endpoint contracts unless explicitly changing spec.
- Add/update tests in `alerts/__tests__/` when behavior changes.
- Prefer shared logic in `mbta-server/streaming/` for reusable stream behavior.
