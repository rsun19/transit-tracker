# Backend Overview (AI Agent Guide)

This document is a quick orientation guide for AI agents making changes under `backend/`.

## Scope

The backend is a Django/ASGI service focused on MBTA alert ingestion and tracking predictions streaming.

Primary goals:
- Fetch MBTA alerts via REST (`/alerts/`)
- Stream transformed alert data via SSE (`/alerts/stream/`)
- Maintain one upstream MBTA stream and fan out updates to clients via Redis pub/sub
- Poll MBTA predictions for rapid transit routes and fan out prediction snapshots via Redis/SSE
- Support route discovery and station-oriented tracking queries

`/alerts/stream/` supports optional per-client route filtering via query params:
- `route_ids` (repeatable or comma-separated)
- `routes` (alias; repeatable or comma-separated)

Examples:
- `/alerts/stream/?route_ids=Red,Orange`
- `/alerts/stream/?route_ids=Red&route_ids=Orange`
- `/alerts/stream/?routes=Blue`

`/tracking/stream/` supports optional per-client route filtering via query params:
- `route_id` (repeatable or comma-separated)

Examples:
- `/tracking/stream/?route_id=Red`
- `/tracking/stream/?route_id=Red,Orange`
- `/tracking/stream/?route_id=Red&route_id=Orange`

## Key Directories

- `mbta-server/mbta/`
  - Django project settings and URL routing.
- `mbta-server/alerts/`
  - Alerts app (views, worker command, stream logic, tests, constants).
- `mbta-server/tracking/`
  - Tracking predictions app (polling worker, Redis-backed indexes/caches, SSE/query endpoints, tests).
- `mbta-server/streaming/`
  - Shared streaming primitives reusable across future packages/apps.

## Important Runtime Components

- **ASGI App** (`uvicorn mbta.asgi:application`)
  - Serves HTTP and SSE endpoints.
- **Background Worker** (`python manage.py mbta_alerts_worker`)
  - Maintains MBTA upstream stream and keeps active alert state in Redis.
  - Applies MBTA stream semantics (`reset`, `add`, `update`, `remove`) to active state.
  - Publishes latest full snapshot to Redis channel (`mbta:alerts`) and snapshot key for replay-on-connect.
- **Tracking Worker** (`python manage.py mbta_predictions_worker`)
  - Polls MBTA predictions for rapid transit routes loaded from static transit data in Redis.
  - Writes snapshot/by-route/by-stop caches and publishes latest predictions snapshot to tracking channel.
- **Redis Broker**
  - Decouples upstream ingestion from downstream fan-out.

## Tracking Endpoints

- `GET /tracking/stream/?route_id=<route_id>`
  - SSE stream of tracking prediction rows (`route_id` filter optional).
- `GET /tracking/routes/`
  - Returns available routes as `{"routes": [{"route_id": "Red", "long_name": "Red Line"}, ...]}`.
- `GET /tracking/stations/?q=<partial-name>&limit=<n>`
  - LIKE-style station search from Redis-backed station index.
- `GET /tracking/predictions/?station_id=<stop_id>`
  - Station-specific prediction rows and snapshot timestamp.

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
- Add/update tests in `tracking/__tests__/` when tracking behavior changes.
- Prefer shared logic in `mbta-server/streaming/` for reusable stream behavior.
