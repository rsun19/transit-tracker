# Configuration Reference

## Environment Variables

Copy `.env.example` to `.env` and fill in values before starting services.

```sh
cp .env.example .env
```

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/transit_tracker` | Full PostgreSQL connection string. In Docker Compose the host is `postgres` (service name). |

### Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string. In Docker Compose the host is `redis`. |

### Agency Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENCY_CONFIG_PATH` | `./config/agencies.json` | Path to the JSON file that lists all transit agencies. Resolved relative to the backend's working directory. |

### API Keys

| Variable | Required | Description |
|----------|----------|-------------|
| `MBTA_API_KEY` | Yes (for MBTA) | Developer API key from [api.mbta.com](https://api.mbta.com). Referenced by `agencies.json` via `apiKeyEnvVar`. |

Add one variable per agency that requires an API key. The name must match the `apiKeyEnvVar` field in `agencies.json`.

### Ingestion Schedule

| Variable | Default | Description |
|----------|---------|-------------|
| `GTFS_INGEST_ON_STARTUP` | `false` | Set to `true` to run a full static GTFS ingest every time the worker starts. Useful when setting up a new environment. |
| `GTFS_STATIC_CRON` | `0 4 * * *` | Cron expression controlling when the worker downloads and re-imports static GTFS feeds. Default is 4:00 AM daily. |
| `GTFS_REALTIME_POLL_INTERVAL_MS` | `15000` | How often (milliseconds) the worker polls GTFS-Realtime feeds for vehicle positions and alerts. |

### Runtime

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Set to `production` for Docker deployments. Controls NestJS and Next.js optimizations. |
| `WORKER_FILE_LIVENESS_PATH` | `/tmp/worker-alive` | Path to the file the worker touches on each successful ingestion cycle. Used by Docker `HEALTHCHECK`. |

---

## Agency Configuration (`config/agencies.json`)

The agency config file is a JSON array. Each element configures one transit provider.

```json
[
  {
    "key": "mbta",
    "displayName": "MBTA",
    "timezone": "America/New_York",
    "gtfsStaticUrl": "https://cdn.mbta.com/MBTA_GTFS.zip",
    "gtfsRealtimeUrl": "https://api-v3.mbta.com/gtfs_rt/VehiclePositions.pb",
    "apiKeyEnvVar": "MBTA_API_KEY"
  }
]
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | URL-safe slug used in API paths and Redis keys (e.g. `mbta`). Must be unique across all agencies. |
| `displayName` | `string` | Yes | Human-readable agency name displayed in the frontend. |
| `timezone` | `string` | Yes | IANA timezone string (e.g. `America/New_York`). Used for service-day calculations and display. |
| `gtfsStaticUrl` | `string` | Yes | URL of the agency's GTFS static ZIP archive. Downloaded on each ingestion cycle. |
| `gtfsRealtimeUrl` | `string \| null` | No | URL of the agency's GTFS-Realtime Protobuf feed. Agencies without realtime data may omit this field or set it to `null`. |
| `apiKeyEnvVar` | `string \| null` | No | Name of the environment variable that holds the API key for this agency's feed URLs. The worker reads `process.env[apiKeyEnvVar]` at runtime. |

### Adding an Agency

1. Add an entry to `config/agencies.json`.
2. If the agency requires an API key, add `AGENCY_API_KEY=your_key` to `.env` and set `apiKeyEnvVar` to `"AGENCY_API_KEY"`.
3. Restart the worker container so it picks up the new config:
   ```sh
   docker compose restart worker
   ```
4. Trigger an initial ingest by setting `GTFS_INGEST_ON_STARTUP=true` in `.env` and restarting the worker:
   ```sh
   docker compose restart worker
   ```
   You can set it back to `false` after the first successful ingest.

---

## Application Constants

These values are compiled into the backend. To change them, edit `backend/src/common/constants.ts` and rebuild.

| Constant | Value | Description |
|----------|-------|-------------|
| `VEHICLE_CACHE_TTL_S` | `30` | TTL (seconds) for `vehicles:{agencyKey}` Redis keys. Vehicles older than this are considered stale. |
| `ALERTS_CACHE_TTL_S` | `30` | TTL (seconds) for `alerts:{agencyKey}` Redis keys. |
| `API_CACHE_DEPARTURES_TTL_S` | `20` | TTL for departure time API responses. |
| `API_CACHE_NEARBY_TTL_S` | `45` | TTL for nearby-stops spatial query results. |
| `API_CACHE_ROUTES_TTL_S` | `300` | TTL for route list and individual route responses. |
| `REALTIME_POLL_INTERVAL_MS` | `15000` | Interval between GTFS-Realtime feed polls (milliseconds). |
| `DEFAULT_SEARCH_LIMIT` | `20` | Default page size for list endpoints that support `limit`. |
| `MAX_SEARCH_LIMIT` | `100` | Maximum allowed value for `limit` query parameter. |
| `NEARBY_DEFAULT_RADIUS_M` | `500` | Default search radius (metres) for `/stops/nearby`. |
| `NEARBY_MAX_RADIUS_M` | `5000` | Maximum allowed radius for `/stops/nearby`. |

---

## NGINX Rate Limiting

NGINX sits in front of all services and applies per-IP rate limiting to the `/api/` path.

| Setting | Value | Description |
|---------|-------|-------------|
| Zone | `api` — 10 MB shared memory | Stores per-IP state. At ~64 B per IP, 10 MB handles ~160,000 tracked clients. |
| Rate | `1 req/s per IP` | Baseline sustained request rate. |
| Burst | `10 requests (nodelay)` | Allows short bursts up to 10 requests without queuing delay. |
| Excess status | `429` | Returns JSON `{"error":"Rate limit exceeded","statusCode":429}`. |
| `/health` | Not rate-limited | Health check endpoint is excluded from the zone. |

To increase the rate limit for an internal or trusted network, add an `allow` / `geo` block before the `limit_req_zone` directive in `nginx.conf` and set a separate zone with a higher rate.

---

## Docker Compose Services

| Service | Internal Port | Exposed Port | Notes |
|---------|--------------|-------------|-------|
| `nginx` | 80 | **8080** | Entry point — routes `/api/` and `/health` to backend, everything else to frontend |
| `frontend` | 3001 | — | Next.js 14 server |
| `backend` | 3000 | — | NestJS API |
| `worker` | — | — | NestJS ingestion worker (no HTTP) |
| `postgres` | 5432 | — | PostgreSQL 16 + PostGIS 3.4 |
| `redis` | 6379 | — | Redis 7 |

All services are on the internal `transit-net` bridge network. Only `nginx` exposes a port to the host by default. To expose `postgres` for local queries, add a `ports` entry to the `postgres` service in `docker-compose.yml`.
