# Data Model: GTFS Transit Tracker Web Application

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28  
**Source**: spec.md Key Entities + research.md geospatial decisions

---

## Storage Layers

| Layer             | Technology                           | Purpose                                 |
| ----------------- | ------------------------------------ | --------------------------------------- |
| Primary store     | PostgreSQL 16 + PostGIS 3.4          | All static GTFS data; source of truth   |
| Realtime cache    | Redis 7 (Hash per agency, TTL-based) | Vehicle positions, trip updates, alerts |
| Application cache | Redis 7 (String/JSON, short TTL)     | API response memoization                |

---

## PostgreSQL Schema

### `agencies`

Core registry of all configured transit providers. One row per agency.

| Column              | Type           | Constraints       | Notes                                                         |
| ------------------- | -------------- | ----------------- | ------------------------------------------------------------- |
| `agency_id`         | `UUID`         | `PRIMARY KEY`     | Generated on insert                                           |
| `agency_key`        | `VARCHAR(50)`  | `UNIQUE NOT NULL` | Slug (e.g. `mbta`); used as namespacing key across all tables |
| `display_name`      | `TEXT`         | `NOT NULL`        | Human-readable name (e.g. `MBTA`)                             |
| `timezone`          | `VARCHAR(64)`  | `NOT NULL`        | IANA timezone string (e.g. `America/New_York`)                |
| `gtfs_static_url`   | `TEXT`         | `NOT NULL`        | Download URL for GTFS static ZIP                              |
| `gtfs_realtime_url` | `TEXT`         |                   | Optional GTFS-RT feed URL                                     |
| `api_key_env_var`   | `VARCHAR(128)` |                   | Name of environment variable holding the feed API key         |
| `last_ingested_at`  | `TIMESTAMPTZ`  |                   | Timestamp of last successful ingestion                        |
| `created_at`        | `TIMESTAMPTZ`  | `DEFAULT NOW()`   |                                                               |

**Constraints**: `agency_key` must be URL-slug-safe (`[a-z0-9-]+`).

---

### `routes`

A named service path operated by an agency.

| Column       | Type           | Constraints                                                 | Notes                                                             |
| ------------ | -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `id`         | `UUID`         | `PRIMARY KEY`                                               |                                                                   |
| `agency_id`  | `UUID`         | `NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE` |                                                                   |
| `route_id`   | `VARCHAR(100)` | `NOT NULL`                                                  | ID from GTFS feed (scoped to agency)                              |
| `short_name` | `VARCHAR(50)`  |                                                             | Route number/code (e.g. `39`, `Red`)                              |
| `long_name`  | `TEXT`         |                                                             | Full name (e.g. `Forest Hills — Back Bay Station`)                |
| `route_type` | `SMALLINT`     | `NOT NULL`                                                  | GTFS route_type integer: 0=tram, 1=subway, 2=rail, 3=bus, 4=ferry |
| `color`      | `VARCHAR(6)`   |                                                             | Hex color without `#`, for map polyline rendering                 |
| `text_color` | `VARCHAR(6)`   |                                                             | Hex text color for contrast                                       |
| `created_at` | `TIMESTAMPTZ`  | `DEFAULT NOW()`                                             |                                                                   |

**Indexes**:

- `UNIQUE (agency_id, route_id)` — GTFS route IDs are scoped per agency
- `INDEX ON (agency_id, route_type)` — for filtering by mode

---

### `stops`

Physical boarding/alighting locations.

| Column                | Type                    | Constraints                                                 | Notes                                         |
| --------------------- | ----------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `id`                  | `UUID`                  | `PRIMARY KEY`                                               |                                               |
| `agency_id`           | `UUID`                  | `NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE` |                                               |
| `stop_id`             | `VARCHAR(100)`          | `NOT NULL`                                                  | ID from GTFS feed                             |
| `stop_name`           | `TEXT`                  | `NOT NULL`                                                  |                                               |
| `stop_code`           | `VARCHAR(50)`           |                                                             | Short code displayed at physical stop         |
| `location`            | `GEOMETRY(Point, 4326)` | `NOT NULL`                                                  | WGS84 lat/lon; PostGIS geometry column        |
| `parent_station_id`   | `VARCHAR(100)`          |                                                             | GTFS parent station stop_id for grouped stops |
| `wheelchair_boarding` | `SMALLINT`              |                                                             | 0=unknown, 1=accessible, 2=inaccessible       |
| `created_at`          | `TIMESTAMPTZ`           | `DEFAULT NOW()`                                             |                                               |

**Indexes**:

- `UNIQUE (agency_id, stop_id)` — scoped per agency
- `GIST INDEX ON (location)` — required for PostGIS geospatial queries (nearest-stop, bounding box)
- `INDEX ON (agency_id, stop_code)` — for code-based lookup

---

### `shapes`

Ordered sequence of coordinate points defining a route's drawn path on the map.

| Column        | Type                    | Constraints                                                 | Notes                           |
| ------------- | ----------------------- | ----------------------------------------------------------- | ------------------------------- |
| `id`          | `UUID`                  | `PRIMARY KEY`                                               |                                 |
| `agency_id`   | `UUID`                  | `NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE` |                                 |
| `shape_id`    | `VARCHAR(100)`          | `NOT NULL`                                                  | From GTFS feed                  |
| `pt_sequence` | `INTEGER`               | `NOT NULL`                                                  | Ordering index within the shape |
| `location`    | `GEOMETRY(Point, 4326)` | `NOT NULL`                                                  | Coordinate of this shape point  |

**Indexes**:

- `INDEX ON (agency_id, shape_id, pt_sequence)` — for ordered shape retrieval
- Shapes for a route are fetched as an ordered set and converted to a GeoJSON LineString for the API response

**Design note**: Shapes are stored as individual points (matching GTFS `shapes.txt`) rather than a single LineString column to allow streaming ingestion without pre-computing the full geometry. The API layer assembles the LineString on read, which is then cached.

---

### `service_calendars`

Defines which days of the week a service pattern operates.

| Column       | Type           | Constraints                                                 | Notes                    |
| ------------ | -------------- | ----------------------------------------------------------- | ------------------------ |
| `id`         | `UUID`         | `PRIMARY KEY`                                               |                          |
| `agency_id`  | `UUID`         | `NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE` |                          |
| `service_id` | `VARCHAR(100)` | `NOT NULL`                                                  | From GTFS `calendar.txt` |
| `monday`     | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `tuesday`    | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `wednesday`  | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `thursday`   | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `friday`     | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `saturday`   | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `sunday`     | `BOOLEAN`      | `NOT NULL`                                                  |                          |
| `start_date` | `DATE`         | `NOT NULL`                                                  |                          |
| `end_date`   | `DATE`         | `NOT NULL`                                                  |                          |

**Indexes**: `UNIQUE (agency_id, service_id)`

---

### `trips`

A specific scheduled run of a vehicle along a route on a given service day.

| Column                  | Type           | Constraints                                                 | Notes                                           |
| ----------------------- | -------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `id`                    | `UUID`         | `PRIMARY KEY`                                               |                                                 |
| `agency_id`             | `UUID`         | `NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE` |                                                 |
| `trip_id`               | `VARCHAR(100)` | `NOT NULL`                                                  | From GTFS feed                                  |
| `route_id`              | `VARCHAR(100)` | `NOT NULL`                                                  | References `routes.route_id` within same agency |
| `service_id`            | `VARCHAR(100)` | `NOT NULL`                                                  | References `service_calendars.service_id`       |
| `shape_id`              | `VARCHAR(100)` |                                                             | References `shapes.shape_id`                    |
| `trip_headsign`         | `TEXT`         |                                                             | Destination text shown on vehicle               |
| `direction_id`          | `SMALLINT`     |                                                             | 0 = outbound, 1 = inbound                       |
| `wheelchair_accessible` | `SMALLINT`     |                                                             | 0=unknown, 1=accessible, 2=inaccessible         |

**Indexes**:

- `UNIQUE (agency_id, trip_id)`
- `INDEX ON (agency_id, route_id)` — for route→trips lookup
- `INDEX ON (agency_id, service_id)` — for calendar filtering

---

### `stop_times`

Associates each stop in sequence with a trip, recording scheduled times.

| Column           | Type           | Constraints   | Notes                                                          |
| ---------------- | -------------- | ------------- | -------------------------------------------------------------- |
| `id`             | `UUID`         | `PRIMARY KEY` |                                                                |
| `agency_id`      | `UUID`         | `NOT NULL`    | Denormalised for partition-friendly DELETE on re-ingestion     |
| `trip_id`        | `VARCHAR(100)` | `NOT NULL`    | References `trips.trip_id` within same agency                  |
| `stop_id`        | `VARCHAR(100)` | `NOT NULL`    | References `stops.stop_id` within same agency                  |
| `stop_sequence`  | `INTEGER`      | `NOT NULL`    | Ordering within the trip                                       |
| `arrival_time`   | `INTERVAL`     |               | Seconds past midnight; can exceed 24:00:00 for overnight trips |
| `departure_time` | `INTERVAL`     | `NOT NULL`    | Same midnight-relative representation                          |
| `pickup_type`    | `SMALLINT`     | `DEFAULT 0`   | 0=regular, 1=no pickup, 2=phone agency, 3=on request           |
| `drop_off_type`  | `SMALLINT`     | `DEFAULT 0`   | Same codes                                                     |

**Indexes**:

- `INDEX ON (agency_id, trip_id, stop_sequence)` — for ordered stop list retrieval
- `INDEX ON (agency_id, stop_id, departure_time)` — for departure board queries (stop → sorted departures)

**Design note**: `arrival_time` / `departure_time` stored as PostgreSQL `INTERVAL` (seconds past midnight) rather than `TIME` because GTFS allows values like `25:00:00` for trips that cross midnight. The API converts to clock time relative to the service date.

---

## Redis Schema

### Vehicle Positions (per agency)

```
Key:   vehicles:{agency_key}
Type:  HASH
Field: {vehicle_id}           (e.g. "y1808")
Value: JSON string:
  {
    "vehicleId": "y1808",
    "latitude": 42.3563,
    "longitude": -71.0621,
    "bearing": 270,
    "speed": 12.5,
    "routeId": "Red",
    "tripId": "63885441",
    "updatedAt": 1711620000000
  }
TTL:   30 seconds (set on every batch write)
```

### API Response Cache

```
Key pattern:  cache:stops:nearby:{lat_rounded3}:{lon_rounded3}:{radius_m}
Key pattern:  cache:stop:departures:{agency_key}:{stop_id}:{date_bucket}
Key pattern:  cache:routes:{agency_key}
Key pattern:  cache:route:{agency_key}:{route_id}
Type:         STRING (JSON blob)
TTL:
  Nearby stops:   45 seconds
  Departures:     20 seconds
  Route list:     300 seconds (5 min; changes only on re-ingestion)
  Route detail:   300 seconds
```

### Service Alerts (per agency)

```
Key:   alerts:{agency_key}
Type:  STRING (JSON array blob)
TTL:   30 seconds
```

---

## Entity Relationships

```text
agencies ──< routes ──< trips ──< stop_times >── stops
agencies ──< stops
agencies ──< shapes
agencies ──< service_calendars

(Redis — no relational constraints)
vehicles:{agencyKey} ← GTFS-RT vehicle positions (TTL 30s)
alerts:{agencyKey}   ← GTFS-RT service alerts (TTL 30s)
cache:*              ← API response memos
```

---

## State Transitions

### Ingestion Lifecycle (per agency)

```
PENDING → DOWNLOADING → PARSING → REPLACING (atomic DB transaction) → COMPLETE
                                                                    ↘ FAILED (rollback; previous data preserved)
```

### Vehicle Position Freshness

```
LIVE    → (TTL expires if worker stops polling) → STALE (key removed from Redis)
↑
Worker writes every ~15 s
```

---

## Validation Rules (from spec FR)

| Entity                  | Rule                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| Agency                  | `agency_key` must be unique and URL-slug-safe                              |
| Agency                  | `api_key_env_var` stores the variable name, not the resolved value         |
| Stop                    | `location` must be a valid WGS84 coordinate (lat: -90..90, lon: -180..180) |
| Stop time               | `departure_time` must be ≥ `arrival_time` for same row                     |
| Route                   | `route_type` must be a valid GTFS integer (0–12)                           |
| Shape                   | `pt_sequence` must be unique within a `shape_id`                           |
| VehiclePosition (Redis) | Must include `updatedAt` timestamp; stale entries auto-expire by TTL       |
