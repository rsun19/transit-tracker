# API Contracts: GTFS Transit Tracker

**Branch**: `001-gtfs-dockerized-app` | **Date**: 2026-03-28  
**Base path**: `/api/v1`  
**Content-Type**: `application/json` (all requests and responses)  
**Auth**: None (public, unauthenticated — per spec A-003)  
**Rate limit**: 60 req/min per IP (NGINX layer; 429 on breach)  
**Error shape**: All error responses use `{ "error": string, "statusCode": number }`

---

## Health

### `GET /health`

Backend liveness probe. Used by Docker Compose health check.

**Response 200**:

```json
{ "status": "ok", "uptime": 12345 }
```

---

## Routes

### `GET /api/v1/routes`

List all routes across all ingested agencies, optionally filtered.

**Query parameters**:

| Param       | Type    | Required | Description                                                |
| ----------- | ------- | -------- | ---------------------------------------------------------- |
| `agencyKey` | string  | No       | Filter by agency slug (e.g. `mbta`)                        |
| `routeType` | integer | No       | GTFS route_type (0=tram, 1=subway, 2=rail, 3=bus, 4=ferry) |
| `q`         | string  | No       | Free-text search on `short_name` or `long_name`            |

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

**Cache**: 300 s Redis key `cache:routes:{agencyKey}` (per agency) or `cache:routes:all`

---

### `GET /api/v1/routes/:routeId`

Returns a single route with its stop list and shape GeoJSON.

**Path parameters**: `routeId` — the GTFS `route_id` value

**Query parameters**:

| Param       | Type   | Required | Description                                            |
| ----------- | ------ | -------- | ------------------------------------------------------ |
| `agencyKey` | string | Yes      | Required to disambiguate same route_id across agencies |

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

Search stops by name or code, optionally filtered by agency.

**Query parameters**:

| Param       | Type    | Required | Description                                                           |
| ----------- | ------- | -------- | --------------------------------------------------------------------- |
| `q`         | string  | Yes      | Search term (≥ 2 chars) — matched against `stop_name` and `stop_code` |
| `agencyKey` | string  | No       | Filter by agency                                                      |
| `limit`     | integer | No       | Max results to return (default: 20, max: 100)                         |

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

**Errors**: `400` if `q` is missing or < 2 chars  
**Cache**: Not cached (full-text search; low latency target met via DB index)

---

### `GET /api/v1/stops/nearby`

Returns stops within a radius sorted by distance.

**Query parameters**:

| Param       | Type    | Required | Description                                       |
| ----------- | ------- | -------- | ------------------------------------------------- |
| `lat`       | float   | Yes      | Latitude (-90..90)                                |
| `lon`       | float   | Yes      | Longitude (-180..180)                             |
| `radius`    | integer | No       | Search radius in metres (default: 500, max: 5000) |
| `agencyKey` | string  | No       | Restrict to one agency                            |
| `limit`     | integer | No       | Max stops to return (default: 20, max: 50)        |

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

- `400` if `lat` or `lon` is missing or out of range
- `400` if `radius` exceeds 5000

**Cache**: 45 s; key `cache:stops:nearby:{lat3dp}:{lon3dp}:{radius}`

---

### `GET /api/v1/stops/:stopId/departures`

Scheduled departures for a stop for the current service day, optionally augmented with realtime delays.

**Path parameters**: `stopId` — GTFS `stop_id`

**Query parameters**:

| Param       | Type    | Required | Description                                                                      |
| ----------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `agencyKey` | string  | Yes      | Agency owning this stop                                                          |
| `limit`     | integer | No       | Max departures (default: 20, max: 100)                                           |
| `after`     | string  | No       | ISO 8601 time (HH:MM); return departures after this time (default: current time) |

**Response 200**:

```json
{
  "stopId": "place-alfcl",
  "stopName": "Alewife",
  "agencyKey": "mbta",
  "generatedAt": "2026-03-28T14:32:00Z",
  "departures": [
    {
      "tripId": "63885441",
      "routeId": "Red",
      "routeShortName": "Red",
      "headsign": "Ashmont",
      "scheduledDeparture": "14:35:00",
      "realtimeDelaySeconds": 120,
      "realtimeDeparture": "14:37:00",
      "hasRealtime": true
    }
  ]
}
```

**Errors**: `404` if stop not found for given agency  
**Cache**: 20 s; key `cache:stop:departures:{agencyKey}:{stopId}:{minuteBucket}`

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

## Vehicles (Realtime)

### `GET /api/v1/vehicles/live`

Returns current vehicle positions for all agencies (or one), sourced from Redis.

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

**When Redis is unavailable**: returns `503` with:

```json
{ "error": "Live tracking temporarily unavailable", "statusCode": 503 }
```

**Cache**: No additional cache — Redis IS the cache layer (TTL 30 s)

---

## Trips

### `GET /api/v1/trips/:tripId`

Returns trip detail including its ordered stop sequence.

**Path parameters**: `tripId`  
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
      "departureTime": "14:35:00"
    }
  ]
}
```

**Errors**: `404` if trip not found  
**Cache**: 300 s

---

## Alerts (Realtime)

### `GET /api/v1/alerts`

Active service alerts sourced from Redis (from GTFS-RT Alerts feed).

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
      "descriptionText": "Red Line trains are experiencing 10-15 minute delays due to a mechanical issue near Charles/MGH.",
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

**Cache**: 30 s via Redis (TTL on `alerts:{agencyKey}` key)

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
      "hasRealtime": true
    }
  ]
}
```

---

## Frontend Health

### `GET /api/health` (Next.js route)

Next.js Route Handler used by Docker Compose health check for the frontend container.

**Response 200**:

```json
{ "status": "ok" }
```

---

## Error Response Shape

All non-2xx responses use:

```json
{
  "error": "Human-readable error description",
  "statusCode": 400
}
```

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| 400    | Invalid or missing query parameters                |
| 404    | Resource not found                                 |
| 429    | Rate limit exceeded (60 req/min per IP)            |
| 503    | Upstream dependency unavailable (Redis down, etc.) |
| 500    | Unexpected server error                            |
