# API Reference

**Base URL**: `http://localhost/api/v1` (via NGINX proxy)  
**Content-Type**: `application/json` for all requests and responses  
**Auth**: None — public, unauthenticated API  
**Rate limit**: 60 requests/min per IP (429 on breach)

All error responses use:

```json
{
  "error": "Human-readable description",
  "statusCode": 400
}
```

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| `400`  | Invalid or missing query parameters                 |
| `404`  | Resource not found                                  |
| `429`  | Rate limit exceeded                                 |
| `503`  | Upstream dependency unavailable (Redis unreachable) |
| `500`  | Unexpected server error                             |

---

## Health

### `GET /health`

Backend liveness probe. Used by the Docker Compose `healthcheck`.

**Response 200**:

```json
{ "status": "ok", "uptime": 12345 }
```

### `GET /api/health`

Frontend (Next.js) liveness probe. Used by the Docker Compose `healthcheck` for the frontend container.

**Response 200**:

```json
{ "status": "ok" }
```

---

## Agencies

### `GET /api/v1/agencies`

Returns all configured and ingested agencies.

**Response 200**:

```json
{
  "data": [
    {
      "agencyKey": "mbta",
      "displayName": "MBTA",
      "timezone": "America/New_York",
      "lastIngestedAt": "2026-03-28T06:00:00Z",
      "hasRealtimePositions": true,
      "hasRealtimeTripUpdates": true
    }
  ]
}
```

---

## Routes

### `GET /api/v1/routes`

List routes across all ingested agencies, with optional filtering and search.

**Query parameters**:

| Param       | Type    | Required | Default | Description                                                         |
| ----------- | ------- | -------- | ------- | ------------------------------------------------------------------- |
| `agencyKey` | string  | No       | —       | Filter by agency slug (e.g. `mbta`)                                 |
| `routeType` | integer | No       | —       | GTFS route_type: `0`=tram, `1`=subway, `2`=rail, `3`=bus, `4`=ferry |
| `q`         | string  | No       | —       | Free-text search on `short_name` or `long_name` (case-insensitive)  |
| `limit`     | integer | No       | `20`    | Max results (max `100`)                                             |
| `offset`    | integer | No       | `0`     | Pagination offset                                                   |

**Response 200**:

```json
{
  "data": [
    {
      "id": "uuid",
      "agencyKey": "mbta",
      "routeId": "Red",
      "shortName": "Red",
      "longName": "Red Line",
      "routeType": 1,
      "color": "DA291C",
      "textColor": "FFFFFF"
    }
  ],
  "total": 214
}
```

**Cache**: 300 s — key `cache:routes:{agencyKey}` or `cache:routes:all`

---

### `GET /api/v1/routes/:routeId`

A single route with its stop list and shape GeoJSON.

**Path parameters**: `routeId` — the GTFS `route_id` value

**Query parameters**:

| Param       | Type   | Required | Description                                                  |
| ----------- | ------ | -------- | ------------------------------------------------------------ |
| `agencyKey` | string | Yes      | Required to disambiguate the same `route_id` across agencies |

**Response 200**:

```json
{
  "id": "uuid",
  "agencyKey": "mbta",
  "routeId": "Red",
  "shortName": "Red",
  "longName": "Red Line",
  "routeType": 1,
  "color": "DA291C",
  "textColor": "FFFFFF",
  "stops": [
    {
      "stopId": "place-alfcl",
      "stopName": "Alewife",
      "latitude": 42.3954,
      "longitude": -71.1425,
      "stopSequence": 1
    }
  ],
  "shape": {
    "type": "LineString",
    "coordinates": [
      [-71.1425, 42.3954],
      [-71.1198, 42.3733]
    ]
  }
}
```

**Errors**: `404` if `routeId` + `agencyKey` not found  
**Cache**: 300 s

---

## Stops

### `GET /api/v1/stops`

Search stops by name or code.

**Query parameters**:

| Param       | Type    | Required | Default | Description                                                           |
| ----------- | ------- | -------- | ------- | --------------------------------------------------------------------- |
| `q`         | string  | Yes      | —       | Search term (≥ 2 chars) — matched against `stop_name` and `stop_code` |
| `agencyKey` | string  | No       | —       | Filter by agency                                                      |
| `limit`     | integer | No       | `20`    | Max results (max `100`)                                               |

**Response 200**:

```json
{
  "data": [
    {
      "stopId": "place-alfcl",
      "agencyKey": "mbta",
      "stopName": "Alewife",
      "stopCode": "AL",
      "latitude": 42.3954,
      "longitude": -71.1425
    }
  ],
  "total": 3
}
```

**Errors**: `400` if `q` is missing or fewer than 2 characters

---

### `GET /api/v1/stops/nearby`

Stops within a radius, sorted by distance. Uses PostGIS KNN (`<->` operator).

**Query parameters**:

| Param       | Type    | Required | Default | Description                          |
| ----------- | ------- | -------- | ------- | ------------------------------------ |
| `lat`       | float   | Yes      | —       | Latitude (-90 to 90)                 |
| `lon`       | float   | Yes      | —       | Longitude (-180 to 180)              |
| `radius`    | integer | No       | `500`   | Search radius in metres (max `5000`) |
| `agencyKey` | string  | No       | —       | Restrict to one agency               |
| `limit`     | integer | No       | `20`    | Max stops to return (max `50`)       |

**Response 200**:

```json
{
  "data": [
    {
      "stopId": "17861",
      "agencyKey": "mbta",
      "stopName": "Massachusetts Ave @ Albany St",
      "stopCode": "17861",
      "latitude": 42.3296,
      "longitude": -71.0823,
      "distanceMetres": 143
    }
  ],
  "searchCentre": { "lat": 42.3303, "lon": -71.0808 },
  "radiusMetres": 500
}
```

**Errors**:

- `400` if `lat` or `lon` is missing or out of valid range
- `400` if `radius` > 5000

**Cache**: 45 s — key `cache:stops:nearby:{lat3dp}:{lon3dp}:{radius}`

---

### `GET /api/v1/stops/:stopId/arrivals`

Upcoming arrivals for a stop on the current service day, optionally augmented with GTFS-RT delays.

**Path parameters**: `stopId` — GTFS `stop_id`

**Query parameters**:

| Param       | Type    | Required | Default | Description                                                 |
| ----------- | ------- | -------- | ------- | ----------------------------------------------------------- |
| `agencyKey` | string  | Yes      | —       | Agency owning this stop                                     |
| `limit`     | integer | No       | `20`    | Max arrivals (max `100`)                                    |
| `after`     | string  | No       | now     | ISO 8601 time `HH:MM`; return only arrivals after this time |

**Response 200**:

```json
{
  "stopId": "place-alfcl",
  "stopName": "Alewife",
  "agencyKey": "mbta",
  "generatedAt": "2026-03-28T14:32:00Z",
  "arrivals": [
    {
      "tripId": "63885441",
      "routeId": "Red",
      "routeShortName": "Red",
      "headsign": "Ashmont",
      "scheduledArrival": "14:35:00",
      "realtimeDelaySeconds": 120,
      "realtimeArrival": "14:37:00",
      "hasRealtime": true
    }
  ]
}
```

**Errors**: `404` if stop not found for the given agency  
**Cache**: 20 s — key `cache:stop:arrivals:{agencyKey}:{stopId}:{minuteBucket}`

---

### `GET /api/v1/stops/:stopId/routes`

All routes serving a stop.

**Path parameters**: `stopId`  
**Query parameters**: `agencyKey` (required)

**Response 200**:

```json
{
  "stopId": "place-alfcl",
  "stopName": "Alewife",
  "routes": [
    {
      "routeId": "Red",
      "shortName": "Red",
      "longName": "Red Line",
      "routeType": 1,
      "color": "DA291C"
    }
  ]
}
```

---

## Trips

### `GET /api/v1/trips/:tripId`

Trip detail including the ordered stop sequence.

**Path parameters**: `tripId` — GTFS `trip_id`  
**Query parameters**: `agencyKey` (required)

**Response 200**:

```json
{
  "tripId": "63885441",
  "agencyKey": "mbta",
  "routeId": "Red",
  "headsign": "Ashmont",
  "directionId": 0,
  "stops": [
    {
      "stopId": "place-alfcl",
      "stopName": "Alewife",
      "stopSequence": 1,
      "arrivalTime": "14:35:00",
      "arrivalTime": "14:35:00"
    }
  ]
}
```

**Errors**: `404` if trip not found  
**Cache**: 300 s

---

## Vehicles (Realtime)

### `GET /api/v1/vehicles/live`

Current vehicle positions sourced directly from Redis (written by the ingestion worker).

**Query parameters**:

| Param       | Type   | Required | Description          |
| ----------- | ------ | -------- | -------------------- |
| `agencyKey` | string | No       | Filter to one agency |

**Response 200**:

```json
{
  "generatedAt": "2026-03-28T14:31:58Z",
  "vehicles": [
    {
      "vehicleId": "y1808",
      "agencyKey": "mbta",
      "latitude": 42.3563,
      "longitude": -71.0621,
      "bearing": 270,
      "speed": 12.5,
      "routeId": "39",
      "tripId": "63885441",
      "updatedAt": "2026-03-28T14:31:45Z"
    }
  ]
}
```

**When Redis is unavailable** → `503`:

```json
{ "error": "Live tracking temporarily unavailable", "statusCode": 503 }
```

Note: Redis IS the cache layer for this endpoint (TTL 30 s). There is no database fallback by design.

---

## Alerts (Realtime)

### `GET /api/v1/alerts`

Active service alerts from the GTFS-RT alerts feed, sourced from Redis.

**Query parameters**:

| Param       | Type   | Required | Description                              |
| ----------- | ------ | -------- | ---------------------------------------- |
| `agencyKey` | string | No       | Filter by agency                         |
| `routeId`   | string | No       | Filter alerts affecting a specific route |
| `stopId`    | string | No       | Filter alerts affecting a specific stop  |

**Response 200**:

```json
{
  "generatedAt": "2026-03-28T14:31:58Z",
  "alerts": [
    {
      "alertId": "alert-123",
      "agencyKey": "mbta",
      "cause": "MAINTENANCE",
      "effect": "REDUCED_SERVICE",
      "headerText": "Red Line delays",
      "descriptionText": "Red Line trains are experiencing 10-15 minute delays.",
      "affectedRoutes": ["Red"],
      "affectedStops": [],
      "activePeriod": {
        "start": "2026-03-28T12:00:00Z",
        "end": "2026-03-28T18:00:00Z"
      }
    }
  ]
}
```

**When no alerts exist or Redis is empty**: returns `{ "alerts": [] }` — does not throw  
**Cache**: Redis key `alerts:{agencyKey}`, TTL 30 s (written by worker)
