# Backend Architecture (AI Agent Guide)

This document describes backend architecture and extension points for AI agents.

## System Diagram (Conceptual)

1. MBTA API (REST + streaming source)
2. Alerts worker (`mbta_alerts_worker`) connects upstream to MBTA stream
3. Tracking worker (`mbta_predictions_worker`) polls MBTA predictions by route
4. Workers publish normalized snapshots/messages to Redis channels/keys
5. SSE endpoints (`/alerts/stream/`, `/tracking/stream/`) subscribe to Redis and push events to clients
6. HTTP query endpoints (`/tracking/routes/`, `/tracking/stations/`, `/tracking/predictions/`) serve Redis-backed data
7. Frontend/EventSource clients consume stream payloads and query endpoints

## MBTA Stream Semantics

Worker processing follows MBTA streaming event types:
- `reset`: replace entire active-alert state with payload set
- `add`: add new alert to active state
- `update`: overwrite existing alert in active state
- `remove`: delete alert from active state

Important behavior:
- Alerts omitted by a later `reset` are treated as removed (soft delete by omission).
- After each state change, worker publishes a full active snapshot.

## Core Modules

### `alerts/const.py`
Central runtime config:
- `MBTA_KEY`
- `MBTA_ALERTS_URL`
- `MBTA_STREAMING_ALERTS_URL`
- `REDIS_URL`
- `ALERTS_CHANNEL`
- `ALERTS_LATEST_SNAPSHOT_KEY`

### `alerts/management/commands/mbta_alerts_worker.py`
Responsibilities:
- Startup snapshot publish (current alerts)
- Long-lived upstream streaming loop
- Parse upstream messages and publish to Redis
- Backoff/retry via shared worker utility

### `alerts/views.py`
- `index`: MBTA alerts REST passthrough endpoint
- `alerts_stream`: SSE endpoint backed by Redis pub/sub
- Applies client payload transformation before streaming to clients
- Supports route filtering via query params (`route_ids`, `routes` alias)

### `alerts/payload_transform.py`
Transforms MBTA payloads to client shape:
- `[{ route, active_period: {start, end}, cause, effect, header, description, url, lifecycle }]`

### `tracking/const.py`
Central tracking runtime config:
- `TRACKING_PREDICTIONS_CHANNEL`
- `TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY`
- station index/cache keys and route polling concurrency settings

### `tracking/management/commands/mbta_predictions_worker.py`
Responsibilities:
- Load rapid transit routes/stops from static transit datasets in Redis
- Poll MBTA predictions concurrently by route
- Normalize/persist snapshot + by-route + by-stop caches
- Publish latest snapshot to Redis for SSE fan-out and replay-on-connect

### `tracking/views.py`
- `tracking_stream`: SSE endpoint backed by Redis pub/sub for prediction snapshots
- Optional route filtering via query param `route_id` (repeatable or comma-separated)
- `available_route_ids`: returns available route objects with `route_id` and `long_name`
- `search_stations`: station name query against Redis-backed station index
- `station_predictions`: station-specific prediction rows

### `tracking/static_dataset.py`
Helpers for versioned static transit dataset reads from Redis:
- route metadata (`route_id`, `long_name`)
- route id lists for worker polling
- rapid transit stops dataset reads

### `tracking/prediction_cache.py`
Redis persistence/projection helpers for tracking predictions:
- write latest snapshot
- read latest snapshot
- read by route
- read by stop/station

### Shared `streaming/` package
Reusable primitives for future packages:
- `broker.py`: Redis client factory
- `codec.py`: broker message encoding/decoding
- `sse.py`: Redis channel to SSE stream logic (snapshot replay + heartbeat + reconnect)
- `worker.py`: generic backoff loop
- `health.py`: in-memory stream health tracking
- `logging.py`: namespaced stream logging helpers

## Reliability Behaviors

- SSE stream remains open and emits periodic heartbeats when idle.
- Redis outage handling retries with capped backoff.
- Worker retries on upstream failures with capped backoff.
- New subscribers replay the latest snapshot from Redis before live pub/sub updates.
- Tracking worker uses concurrent route polling and publishes full snapshot updates for consistent client state.

## Extension Guidance (for new packages)

When adding new stream-capable packages/apps:
1. Add app-specific constants (channel names, upstream URLs, auth keys).
2. Reuse `streaming/` modules rather than duplicating broker/SSE/backoff logic.
3. Implement app-specific payload transforms in the app package.
4. Add a dedicated management command for upstream ingestion.
5. Add app to `INSTALLED_APPS` for command discovery.

## Testing Strategy

- Unit tests for:
  - payload transform
  - codec helpers
  - stream utility behavior where practical
  - tracking route/station/prediction cache and static dataset helpers
- Integration tests for:
  - `/alerts/stream/` response format and headers
  - worker publish path (mock upstream and/or Redis client)
  - `/tracking/stream/`, `/tracking/routes/`, `/tracking/stations/`, `/tracking/predictions/`

## Operational Notes

- Worker and ASGI server both must be running for live stream behavior.
- In Docker dev mode, code is bind-mounted and backend/frontend hot reload is enabled.
- Redis connectivity is required for fan-out; worker and SSE endpoint degrade via retry loops when Redis is temporarily unavailable.
