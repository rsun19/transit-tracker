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

Upcoming departures for a stop, merged with GTFS-RT predictions. Trips scheduled up to 90 min ago are still listed if a prediction says they are coming; canceled trips, skipped stops, stops the vehicle has passed, and drop-off-only rows (`pickup_type = 1`) are hidden. Rows are sorted by effective time (prediction, else schedule).

**Path parameters**: `stopId` — GTFS `stop_id`

**Query parameters**:

| Param       | Type    | Required | Default | Description                                              |
| ----------- | ------- | -------- | ------- | -------------------------------------------------------- |
| `agencyKey` | string  | Yes      | —       | Agency owning this stop                                  |
| `limit`     | integer | No       | `20`    | Max arrivals (max `100`)                                 |
| `after`     | string  | No       | now     | ISO 8601 timestamp; return only arrivals after this time |

**Response 200**:

```json
{
  "stopId": "place-alfcl",
  "stopName": "Alewife",
  "agencyKey": "mbta",
  "timezone": "America/New_York",
  "feedTimestamp": 1792065420,
  "data": [
    {
      "tripId": "63885441",
      "routeId": "Red",
      "routeShortName": null,
      "routeLongName": "Red Line",
      "headsign": "Ashmont",
      "directionId": 0,
      "scheduledTime": "2026-03-28T14:35:00.000Z",
      "predictedTime": "2026-03-28T14:37:00.000Z",
      "realtimeArrival": "2026-03-28T14:37:00.000Z",
      "realtimeDelaySeconds": 120,
      "hasRealtime": true,
      "status": "late",
      "uncertaintySeconds": 60
    }
  ]
}
```

- Times are the **arrival** time, else the departure (a trip's first stop), as MBTA shows them. `departureTime` is when the vehicle leaves the stop; between the two it is boarding. A train stays listed until its predicted departure, so one at the platform can show an arrival time just in the past.
- `timezone` is the agency's IANA timezone. Clients show times in it, as station clocks and mbta.com do, whatever the device's timezone.
- `feedTimestamp` is the header timestamp (epoch seconds) of the GTFS-RT feed the predictions came from, or `null` when no realtime data was available. The stop page shows its age and warns past 2 minutes.
- `realtimeArrival` is the effective time (`predictedTime` if present, else `scheduledTime`), kept for compatibility.
- `realtimeDelaySeconds` is `predictedTime − scheduledTime`; `null` without a prediction.
- `hasRealtime` is true only when a prediction exists.
- `status`: `scheduled` (no prediction), `on_time` / `late` / `early` (±60 s threshold, `ARRIVAL_ON_TIME_THRESHOLD_S`), or `added` (extra service with no scheduled trip; `scheduledTime` and `realtimeDelaySeconds` are `null`). `canceled` and `skipped` exist in the type but those rows are currently filtered out.

**Errors**: `404` if stop not found for the given agency  
**Cache**: 5 s — key `cache:arrivals:v7:{agencyKey}:{stopId}:{limit}:{after}`

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

Trip detail including the ordered stop sequence, with scheduled times expanded for one service day.

**Path parameters**: `tripId` — GTFS `trip_id`  
**Query parameters**:

| Param         | Type   | Required | Description                                                                                                                                                                                              |
| ------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agencyKey`   | string | Yes      | Agency                                                                                                                                                                                                   |
| `serviceDate` | string | No       | `YYYYMMDD` service day. Default: the day the trip is running now in the agency timezone (yesterday's run while it may still be on the road, else today's), using `calendar.txt` and `calendar_dates.txt` |

**Response 200**:

```json
{
  "tripId": "63885441",
  "serviceDate": "20261016",
  "routeId": "Red",
  "headsign": "Ashmont",
  "stops": [
    {
      "sequence": 1,
      "stopId": "70061",
      "stopName": "Alewife",
      "stopCode": null,
      "lat": 42.3954,
      "lon": -71.1424,
      "scheduledArrival": "2026-10-16T18:35:00.000Z",
      "realtimeArrival": "2026-10-16T18:35:00.000Z",
      "scheduledDeparture": "2026-10-16T18:35:00.000Z"
    }
  ]
}
```

`realtimeArrival` is the scheduled time; trip detail doesn't merge predictions yet.

**Errors**: `400` if `serviceDate` isn't a valid `YYYYMMDD` date; `404` if the trip or agency is not found  
**Cache**: 60 s

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
      "cause": "MAINTENANCE",
      "effect": "REDUCED_SERVICE",
      "headerText": "Red Line delays",
      "descriptionText": "Red Line trains are experiencing 10-15 minute delays.",
      "activePeriods": [{ "start": 1774699200, "end": 1774720800 }],
      "informedEntities": [{ "routeId": "Red", "routeType": null, "stopId": null, "tripId": null }],
      "routeIds": ["Red"],
      "stopIds": [],
      "tripIds": []
    }
  ]
}
```

Only alerts inside one of their `activePeriods` are returned (no periods = always active). Active-period times are epoch seconds; `null` means open-ended. The `stopId` filter matches a parent station or any of its child platforms.

**When no alerts exist or Redis is empty**: returns `{ "alerts": [] }` — does not throw  
**Cache**: Redis key `alerts:{agencyKey}`, TTL 30 s (written by worker)
