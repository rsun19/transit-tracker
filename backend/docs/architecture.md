# Backend Architecture (AI Agent Guide)

This document describes backend architecture and extension points for AI agents.

## System Diagram (Conceptual)

1. MBTA API (REST + streaming source)
2. Alerts worker (`mbta_alerts_worker`) connects upstream to MBTA
3. Worker publishes normalized alert messages to Redis (`mbta:alerts`)
4. SSE endpoint (`/alerts/stream/`) subscribes to Redis and pushes events to clients
5. Frontend/EventSource clients consume transformed stream payloads

## Core Modules

### `alerts/const.py`
Central runtime config:
- `MBTA_KEY`
- `MBTA_ALERTS_URL`
- `MBTA_STREAMING_ALERTS_URL`
- `REDIS_URL`
- `ALERTS_CHANNEL`

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

### `alerts/payload_transform.py`
Transforms MBTA payloads to client shape:
- `[{ route, active_period: {start, end}, cause, effect, header, description, url, lifecycle }]`

### Shared `streaming/` package
Reusable primitives for future packages:
- `broker.py`: Redis client factory
- `codec.py`: broker message encoding/decoding
- `sse.py`: Redis channel to SSE stream logic (heartbeat + reconnect)
- `worker.py`: generic backoff loop
- `health.py`: in-memory stream health tracking
- `logging.py`: namespaced stream logging helpers

## Reliability Behaviors

- SSE stream remains open and emits periodic heartbeats when idle.
- Redis outage handling retries with capped backoff.
- Worker retries on upstream failures with capped backoff.
- Initial status/empty SSE events can be emitted before data arrives.

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
- Integration tests for:
  - `/alerts/stream/` response format and headers
  - worker publish path (mock upstream and/or Redis client)

## Operational Notes

- Worker and ASGI server both must be running for live stream behavior.
- In Docker dev mode, code is bind-mounted and backend/frontend hot reload is enabled.
- Redis connectivity is required for fan-out; worker and SSE endpoint degrade via retry loops when Redis is temporarily unavailable.
