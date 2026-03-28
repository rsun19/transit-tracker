# Data Model

## Storage Layers

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Primary store | PostgreSQL 16 + PostGIS 3.4 | All static GTFS data — source of truth |
| Realtime cache | Redis 7 (per-agency keys, TTL-based) | Vehicle positions and service alerts |
| Response cache | Redis 7 (short TTL string keys) | Memoized API responses |

---

## PostgreSQL Schema

All tables share a common design principle: every row includes an `agency_id UUID FK` column, so data from different agencies is isolated by row without duplicating the schema. The `agency_id` is always the first column in composite indexes to enable efficient per-agency filtering and deletion.

### `agencies`

One row per configured transit provider.

| Column | Type | Constraints |
|--------|------|-------------|
| `agency_id` | `UUID` | `PRIMARY KEY` |
| `agency_key` | `VARCHAR(50)` | `UNIQUE NOT NULL` — URL-slug (e.g. `mbta`) |
| `display_name` | `TEXT` | `NOT NULL` |
| `timezone` | `VARCHAR(64)` | `NOT NULL` — IANA timezone string |
| `gtfs_static_url` | `TEXT` | `NOT NULL` |
| `gtfs_realtime_url` | `TEXT` | nullable |
| `api_key_env_var` | `VARCHAR(128)` | nullable — name of env var holding the API key |
| `last_ingested_at` | `TIMESTAMPTZ` | nullable |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` |

### `routes`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL REFERENCES agencies ON DELETE CASCADE` |
| `route_id` | `VARCHAR(100)` | `NOT NULL` — from GTFS feed |
| `short_name` | `VARCHAR(50)` | nullable |
| `long_name` | `TEXT` | nullable |
| `route_type` | `SMALLINT` | `NOT NULL` — 0=tram, 1=subway, 2=rail, 3=bus, 4=ferry |
| `color` | `VARCHAR(6)` | nullable — hex without `#` |
| `text_color` | `VARCHAR(6)` | nullable |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` |

**Indexes**: `UNIQUE (agency_id, route_id)` · `INDEX (agency_id, route_type)`

### `stops`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL REFERENCES agencies ON DELETE CASCADE` |
| `stop_id` | `VARCHAR(100)` | `NOT NULL` — from GTFS feed |
| `stop_name` | `TEXT` | `NOT NULL` |
| `stop_code` | `VARCHAR(50)` | nullable |
| `location` | `GEOMETRY(Point, 4326)` | `NOT NULL` — WGS84 lat/lon |
| `parent_station_id` | `VARCHAR(100)` | nullable |
| `wheelchair_boarding` | `SMALLINT` | 0=unknown, 1=accessible, 2=inaccessible |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` |

**Indexes**: `UNIQUE (agency_id, stop_id)` · `GiST INDEX (location)` — required for PostGIS spatial queries · `INDEX (agency_id, stop_code)`

### `trips`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL REFERENCES agencies ON DELETE CASCADE` |
| `trip_id` | `VARCHAR(100)` | `NOT NULL` |
| `route_id` | `VARCHAR(100)` | `NOT NULL` |
| `service_id` | `VARCHAR(100)` | `NOT NULL` |
| `shape_id` | `VARCHAR(100)` | nullable |
| `trip_headsign` | `TEXT` | nullable |
| `direction_id` | `SMALLINT` | 0=outbound, 1=inbound |
| `wheelchair_accessible` | `SMALLINT` | |

**Indexes**: `UNIQUE (agency_id, trip_id)` · `INDEX (agency_id, route_id)` · `INDEX (agency_id, service_id)`

### `stop_times`

Associates stops with trips in sequence order. This is the largest table — MBTA has ~500 K rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL` — denormalized for efficient per-agency DELETE |
| `trip_id` | `VARCHAR(100)` | `NOT NULL` |
| `stop_id` | `VARCHAR(100)` | `NOT NULL` |
| `stop_sequence` | `INTEGER` | `NOT NULL` |
| `arrival_time` | `INTERVAL` | nullable |
| `departure_time` | `INTERVAL` | `NOT NULL` |
| `pickup_type` | `SMALLINT` | `DEFAULT 0` |
| `drop_off_type` | `SMALLINT` | `DEFAULT 0` |

**Indexes**: `INDEX (agency_id, trip_id, stop_sequence)` · `INDEX (agency_id, stop_id, departure_time)`

> **Why `INTERVAL` for times?** GTFS allows departure times past midnight (e.g. `25:30:00` for a trip at 1:30 AM the next service day). PostgreSQL `TIME` rejects these values. `INTERVAL` stores them as seconds past midnight and compares correctly across the service day boundary.

### `shapes`

Ordered coordinate points that define a route's geometry on the map.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL REFERENCES agencies ON DELETE CASCADE` |
| `shape_id` | `VARCHAR(100)` | `NOT NULL` |
| `pt_sequence` | `INTEGER` | `NOT NULL` |
| `location` | `GEOMETRY(Point, 4326)` | `NOT NULL` |

**Indexes**: `INDEX (agency_id, shape_id, pt_sequence)` — for ordered shape retrieval

Shapes are stored as individual points (matching GTFS `shapes.txt`) and assembled into a GeoJSON `LineString` by the API layer on the first cache miss, then cached for 300 s.

### `service_calendars`

Service pattern schedule — which days of the week a service runs.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | `PRIMARY KEY` |
| `agency_id` | `UUID` | `NOT NULL REFERENCES agencies ON DELETE CASCADE` |
| `service_id` | `VARCHAR(100)` | `NOT NULL` |
| `monday` … `sunday` | `BOOLEAN` | `NOT NULL` |
| `start_date` | `DATE` | `NOT NULL` |
| `end_date` | `DATE` | `NOT NULL` |

**Indexes**: `UNIQUE (agency_id, service_id)`

Ingestion also parses `calendar_dates.txt` to apply service exceptions (added/removed service days) updating these rows.

---

## Entity Relationships

```text
agencies ──< routes ──< trips ──< stop_times >── stops
agencies ──< stops
agencies ──< shapes
agencies ──< service_calendars
```

All foreign key relationships cascade `ON DELETE CASCADE` from `agencies`, so dropping an agency row removes all its GTFS data atomically.

---

## Redis Key Design

### Realtime keys (written by ingestion worker)

| Key | Type | Content | TTL |
|-----|------|---------|-----|
| `vehicles:{agencyKey}` | `STRING` | JSON array of vehicle positions | 30 s |
| `alerts:{agencyKey}` | `STRING` | JSON array of service alerts | 30 s |

Both keys are written atomically via a Redis pipeline on each realtime poll cycle. If the key expires (worker stopped), the vehicles endpoint returns `503` and the alerts endpoint returns an empty array.

### API response cache keys (written by API server)

| Key pattern | TTL | Invalidation |
|-------------|-----|-------------|
| `cache:routes:{agencyKey}` | 300 s | Expires naturally; refreshed after GTFS static ingest |
| `cache:route:{agencyKey}:{routeId}` | 300 s | — |
| `cache:stop:departures:{agencyKey}:{stopId}:{bucket}` | 20 s | — |
| `cache:stops:nearby:{lat3dp}:{lon3dp}:{radius}` | 45 s | — |

`{lat3dp}` and `{lon3dp}` are latitude/longitude rounded to 3 decimal places (~100 m precision) to improve cache hit rate for nearby-stop queries from slightly different coordinates.

---

## Ingestion Transaction Pattern

Each agency's static GTFS ingest runs inside a single `SERIALIZABLE` transaction:

```sql
BEGIN;
  DELETE FROM stop_times   WHERE agency_id = $agencyId;
  DELETE FROM shapes       WHERE agency_id = $agencyId;
  DELETE FROM trips        WHERE agency_id = $agencyId;
  DELETE FROM stop_times   WHERE agency_id = $agencyId;
  DELETE FROM routes       WHERE agency_id = $agencyId;
  DELETE FROM stops        WHERE agency_id = $agencyId;
  DELETE FROM service_calendars WHERE agency_id = $agencyId;
  -- INSERT new data in 1000-row batches
  INSERT INTO routes ... (batch 1)
  INSERT INTO routes ... (batch 2)
  ...
COMMIT;
UPDATE agencies SET last_ingested_at = NOW() WHERE agency_id = $agencyId;
```

If any step fails, the entire transaction rolls back and the previous data remains intact. No other agency's rows are touched.
