# Feature Specification: GTFS Transit Tracker Web Application

**Feature Branch**: `001-gtfs-dockerized-app`  
**Created**: 2026-03-28  
**Status**: Draft  
**Input**: Scalable dockerized GTFS web application with Next.js frontend, NestJS backend, PostgreSQL+PostGIS, Redis caching, GTFS ingestion worker, and NGINX reverse proxy supporting plug-in transit agency configuration

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Route & Stop Discovery (Priority: P1)

A rider opens the application and searches for transit routes by name or number. They can also look up a specific stop to see which routes serve it and view the day's scheduled departure times. This represents the foundational read layer of the application — the static schedule experience.

**Why this priority**: Without the ability to browse routes and stops from ingested GTFS static data, no other feature has value. This is the minimum viable product and the anchor of Phase 1 development.

**Independent Test**: Seed the database with MBTA GTFS static data, then search for a route (e.g., "Red Line") and confirm the correct stop list, stop sequence, and departure times are displayed without any realtime components running.

**Acceptance Scenarios**:

1. **Given** GTFS static data has been ingested, **When** a rider searches for a route by name, **Then** a list of matching routes is displayed with their stop sequences
2. **Given** a route is displayed, **When** the rider selects a stop from the route, **Then** all scheduled departures for that stop for the current day are shown
3. **Given** a rider searches for a stop by name or code, **When** the search completes, **Then** all routes serving that stop are listed
4. **Given** the rider enters a search term with no matches, **When** results are returned, **Then** a clear "No results found" message is displayed with a suggestion to try different terms
5. **Given** the application has just started, **When** no GTFS data has been ingested yet, **Then** the application displays an explicit "No data available yet" state rather than an error

---

### User Story 2 - Live Vehicle Position Tracking (Priority: P2)

A rider wants to see where buses or trains are right now on an interactive map. Vehicle markers update automatically to reflect current positions along routes, so riders can judge when a vehicle will arrive without guessing.

**Why this priority**: Real-time vehicle tracking is the core differentiating value of a transit tracker over a static printed schedule. It directly reduces uncertainty and missed-vehicle events for riders.

**Independent Test**: Enable realtime feed polling with fixture GTFS-RT protobuf data and verify that vehicle position markers appear on the OpenStreetMap-based map and move as the fixture data updates — without the stop-discovery user story needing to be complete.

**Acceptance Scenarios**:

1. **Given** the realtime feed is active and returning vehicle positions, **When** a rider opens the live map view, **Then** each vehicle appears as a marker on the OpenStreetMap map at its current position

- **Given** a vehicle has moved, **When** the rider watches the map, **Then** the vehicle's marker updates to reflect the new position within 30 seconds via automatic client-side polling every 15 seconds, without a manual page refresh

3. **Given** the rider selects a vehicle marker, **When** the detail panel opens, **Then** the vehicle's assigned route, next scheduled stop, and time of last position update are displayed
4. **Given** the realtime feed is temporarily unavailable, **When** the rider views the live map, **Then** a clearly visible notice says "Live tracking is temporarily unavailable" and the map remains functional showing route shapes and static stop markers
5. **Given** route shapes are stored, **When** the map loads, **Then** each route's path is drawn as a coloured polyline on the map

---

### User Story 3 - Nearby Stops Discovery (Priority: P3)

A rider standing at or near a location wants to see which transit stops are within walking distance (≤ 500 m by default) and view upcoming departures — combining static schedule data with any available realtime delay information — without needing to know stop names or numbers in advance.

**Why this priority**: Location-aware discovery is the primary mobile use case and dramatically lowers the barrier to entry for new riders unfamiliar with the network.

**Independent Test**: Issue a nearby-stops query with a fixed test coordinate and confirm that stops within 500 m are returned sorted by distance, with upcoming departures listed per stop.

**Acceptance Scenarios**:

1. **Given** a rider shares their device location or enters a location manually, **When** they request nearby stops, **Then** all stops within the configured radius (default 500 m) are listed, sorted from nearest to furthest
2. **Given** nearby stops are listed, **When** the rider selects a stop, **Then** upcoming departures are shown with route name, scheduled time, and real-time delay in minutes (where available)
3. **Given** the rider's browser denies location permission, **When** the nearby-stops feature is opened, **Then** a manual location entry field is presented as a fallback with no loss of core functionality
4. **Given** no stops exist within the search radius, **When** the search completes, **Then** the application shows a "No stops found nearby" message and offers a "Search wider area" option that doubles the radius

---

### User Story 4 - Multi-Agency Plug-In Configuration (Priority: P4)

A system operator wants to add a new transit agency to the platform. By supplying a configuration entry (agency name, static GTFS feed URL, optional realtime URL, optional API key reference), the ingestion pipeline automatically downloads, parses, and serves that agency's data alongside existing agencies — with zero code changes required.

**Why this priority**: The entire platform is designed to be agency-agnostic. The plug-in capability makes the system reusable across cities and transit networks and prevents tight coupling to any single provider.

**Independent Test**: Add a second publicly available GTFS feed to the configuration, run the ingestion job, and confirm that the new agency's routes and stops appear in the application alongside MBTA data without any existing data being altered.

**Acceptance Scenarios**:

1. **Given** a new agency entry is added to the configuration file with a valid GTFS static feed URL, **When** the scheduled ingestion job runs, **Then** that agency's routes, stops, trips, and shapes are available in the application
2. **Given** two agencies are configured, **When** both feeds are ingested, **Then** each agency's data is namespaced separately so there are no collisions between identically named stops or routes
3. **Given** an agency's feed URL is invalid or unreachable, **When** the ingestion job attempts to download it, **Then** an error is recorded, that agency's existing data is preserved unchanged, and all other agencies continue to function normally
4. **Given** an agency provides an API key requirement, **When** the configuration references an environment variable for that key, **Then** the ingestion service resolves and uses the key without it being stored in version-controlled files

---

### Edge Cases

- When a GTFS static feed is updated mid-day: the next scheduled ingestion replaces all agency data atomically; mid-day feed changes are not reflected until the next ingestion cycle, as intra-day partial updates are not supported.
- On first startup before any ingestion job has completed (empty database): all data-driven views display the explicit "No data available yet" empty state as mandated by FR-014; no error page is shown.
- When a realtime vehicle position references a trip ID not present in the static dataset: the position record is logged at WARN level and silently discarded; the unresolvable vehicle is not displayed on the map (FR-026).
- Service alerts affecting multiple routes or stops across agencies: each alert entity is displayed once on all relevant route and stop detail views; affected routes and stops are listed inline within the alert banner; alerts are scoped to their originating agency and do not cross agency boundaries.
- When the user's browser denies geolocation permission: a manual location entry field is presented as the fallback for the nearby-stops feature (US3 AS3); all other views are unaffected.
- When a GTFS feed ZIP archive is malformed or only partially downloaded: the ingestion job aborts that agency's ingest before opening a database transaction, logs the failure at ERROR level, and preserves the agency's existing database records unchanged (FR-025).
- When the Redis cache layer is unavailable: all API endpoints fall back to direct PostgreSQL queries; Redis unavailability is transparent to the client and does not produce 5xx errors (FR-024).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST provide a searchable and browsable catalog of transit routes and stops populated from ingested GTFS static data
- **FR-002**: The system MUST display all scheduled departure times for a selected stop for the current service day
- **FR-003**: The system MUST display live vehicle positions on an OpenStreetMap-based interactive map, with positions no more than 30 seconds stale under normal conditions
- **FR-004**: The system MUST allow riders to discover transit stops within a configurable radius of a given location (default: 500 m), sorted by distance
- **FR-005**: The system MUST serve all transit data (static and realtime) exclusively through a unified HTTP API; the frontend MUST NOT directly parse or fetch GTFS feeds
- **FR-006**: The system MUST ingest GTFS static data (ZIP archives of CSV files) automatically on a scheduled basis without manual operator intervention
- **FR-007**: The system MUST poll GTFS Realtime feeds for vehicle positions, trip updates, and service alerts at a configurable interval (default: every 15 seconds)
- **FR-008**: The system MUST store realtime vehicle positions in a fast-access cache with a time-to-live of 10–15 seconds
- **FR-009**: The system MUST cache API responses for nearby-stop queries and departure lists with appropriate short-lived time-to-live values (15–60 seconds)
- **FR-010**: Transit agency sources MUST be fully config-driven; adding a new agency MUST require only a configuration file change and no code changes
- **FR-011**: The entire application stack MUST start successfully from a clean state using a single `docker compose up` command
- **FR-012**: Route shapes MUST be rendered as coloured polylines on the map so riders can visually trace a route's path
- **FR-013**: The system MUST display service alert banners on affected route and stop views when active disruptions exist
- **FR-014**: Every data-driven view MUST have an explicit loading state and an explicit empty/no-results state; blank or spinner-only screens are not acceptable
- **FR-015**: The system MUST support efficient geospatial queries including nearest-stop lookup and bounding-box filtering
- **FR-016**: Agency API keys MUST be supplied via environment variables and MUST NOT be stored in version-controlled configuration files
- **FR-017**: The system MUST expose the following HTTP endpoints at minimum: stop search, stop departures, route list, route detail, nearby stops, live vehicle positions, and service alerts
- **FR-018**: All HTTP API endpoints MUST follow a consistent RESTful URL convention with versioning support (e.g., `/api/v1/stops`)
- **FR-019**: GTFS static feed re-ingestion for an existing agency MUST perform a full atomic replacement — all existing records for that agency are deleted and new records inserted within a single database transaction; partial or additive merges are not permitted
- **FR-020**: The NGINX reverse proxy MUST enforce per-IP rate limiting of 60 requests per minute on all routes; requests exceeding this limit MUST receive a `429 Too Many Requests` response
- **FR-021**: Every service in the Docker Compose stack (frontend, backend, worker, database, cache) MUST expose a `/health` HTTP endpoint returning `200 OK` when healthy; Docker Compose health checks MUST use these endpoints to gate service startup ordering
- **FR-022**: All services MUST emit structured (JSON-formatted) logs to stdout; log entries MUST include at minimum: timestamp, log level, service name, and message
- **FR-023**: The frontend map MUST refresh live vehicle positions by client-side polling the `/api/v1/vehicles/live` endpoint every 15 seconds; no manual user action is required to trigger a refresh
- **FR-024**: When the Redis cache is unreachable, API endpoints that serve cached data MUST fall back to direct PostgreSQL queries and MUST NOT return 5xx errors to clients due to cache unavailability alone
- **FR-025**: If a GTFS static feed ZIP archive is malformed, corrupted, or only partially downloaded, the ingestion job MUST abort that agency's ingest before opening a database transaction, log the failure at ERROR level, and preserve the agency's existing database records unchanged
- **FR-026**: When a GTFS Realtime feed contains a vehicle position referencing a trip_id absent from the ingested static dataset, the system MUST log the occurrence at WARN level and discard that vehicle position; unresolvable vehicles MUST NOT be displayed on the map
- **FR-027**: Route and stop search MUST be performed server-side using case-insensitive substring matching (SQL ILIKE) against name, short name, and stop code fields; search endpoints MUST support pagination via `limit` and `offset` query parameters

### Key Entities

**Identity & Namespacing**: All feed-sourced entities (Routes, Stops, Trips, Shapes, StopTimes) use a composite identifier of `(agency_id, raw_feed_id)` as their primary key. The `agency_id` acts as a namespace, preventing ID collisions between agencies that may use identical numeric or string identifiers in their feeds.

- **Agency**: A transit provider (e.g., MBTA). Identified by a unique key, has a display name, timezone, and one or more GTFS feed URLs. API credentials stored as environment variable references, not literal values.
- **Route**: A named path operated by an agency. Has a short name, long name, and mode type (bus, subway, rail, ferry, cable car, etc.). Belongs to one agency.
- **Stop**: A physical boarding/alighting location. Has a name, stop code, geographic coordinates, and optionally a parent station. May be served by routes from multiple agencies.
- **Trip**: A specific scheduled run of a vehicle along a route on a given service day. References a route, a service calendar, and an ordered list of stop times.
- **StopTime**: Associates a stop with a trip at a specific sequence position, recording scheduled arrival and departure times.
- **Shape**: An ordered sequence of geographic coordinate points representing the drawn path of a route variant on the map.
- **VehiclePosition**: A realtime snapshot of a vehicle's current geographic location, assigned route and trip, and last-updated timestamp. Held in the fast-access cache layer.
- **TripUpdate**: A realtime prediction of arrival and departure times for each remaining stop on an in-progress trip, including delay in seconds.
- **ServiceAlert**: A realtime notification describing a disruption (delay, detour, suspension) affecting one or more routes, stops, or trips; includes human-readable cause and effect text.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A rider can go from opening the application to viewing scheduled departures for a specific stop in under 60 seconds, with no prior knowledge of the interface
- **SC-002**: The complete application stack starts and reaches a healthy state from a clean machine using a single command in under 5 minutes
- **SC-003**: Route and stop search results are presented to the rider within 1 second of submitting a query (p95 across all queries)
- **SC-004**: Live vehicle positions displayed on the map are never more than 30 seconds behind the realtime feed under normal operating conditions
- **SC-005**: A nearby-stop query returns results within 2 seconds for any location within the ingested dataset coverage area (p95)
- **SC-006**: Adding a new transit agency configuration and running the ingestion job results in that agency's data being queryable within 15 minutes, for a feed with up to 500,000 stop-time records
- **SC-007**: The application remains usable for riders — displaying the most recent cached data with a visible "Live updates paused" notice — for at least 5 minutes when the realtime feed is unavailable
- **SC-008**: All primary user interactions are operable by keyboard and screen reader and meet WCAG 2.1 AA contrast and focus requirements
- **SC-009**: Adding a second transit agency requires zero code changes and can be completed by a developer following the setup guide in under 10 minutes
- **SC-010**: The application handles up to 500 concurrent users without API response times exceeding the p95 targets defined in SC-003 and SC-005

## Assumptions

- **A-001**: The initial agency target is MBTA (Boston, MA, USA). All default configuration examples and fixture data reference MBTA feeds. Other agencies are architecturally supported from day one.
- **A-002**: User geolocation access (for the nearby-stops feature) is browser-permission-based and entirely optional; the feature degrades gracefully to manual coordinate or address input.
- **A-003**: The application is intended for public, unauthenticated access. User accounts, saved preferences, and per-user data are out of scope for this phase.
- **A-004**: OpenStreetMap tiles are served from a public tile provider. A self-hosted tile server is not required for this phase.
- **A-005**: GTFS static data ingestion runs once daily by default; the schedule is configurable. Realtime feed polling defaults to every 15 seconds and is also configurable.
- **A-006**: All GTFS feeds are either publicly accessible or accessible via a single static API key stored as an environment variable. OAuth flows or dynamic credential refresh for feed access are out of scope.
- **A-007**: The Docker Compose configuration is the canonical local development and single-machine deployment environment. Cloud or orchestrated (Kubernetes) deployment is a future concern.
- **A-008**: SSL certificate provisioning and renewal for production are external concerns; the NGINX service handles SSL termination when a certificate is provided.
- **A-009**: The NGINX reverse proxy routes `/` to the frontend and `/api` to the backend. No sub-path routing beyond this two-path split is required initially.
- **A-010**: Material UI (MUI v6) is the prescribed UI component library for all frontend components. All interactive and layout components are built on MUI primitives using named imports for tree-shaking. Custom global styles are applied through MUI's `createTheme` API; raw CSS files are used only for Leaflet map integration.

## Clarifications

### Session 2026-03-28

- Q: When re-ingesting a GTFS static feed for an existing agency, what happens to current data? → A: Full atomic replacement — all existing data for that agency is deleted and replaced within a single database transaction; a brief read-only window during the swap is acceptable given once-daily ingestion frequency.
- Q: What is the expected concurrent user load target? → A: Small production scale — up to 500 concurrent users without degradation.
- Q: Should the public REST API have rate limiting enforced? → A: Yes, per-IP rate limiting at the NGINX proxy layer (60 requests/minute per IP); no application-code changes required.
- Q: What level of observability is required? → A: Standard — structured logs from all services plus a `/health` HTTP endpoint on each service used by Docker Compose health checks; no Prometheus or tracing required in this phase.
- Q: How should the frontend map refresh live vehicle positions? → A: Client-side polling — the frontend calls `/api/v1/vehicles/live` every 15 seconds; this aligns with the server-side 15-second feed poll and satisfies the 30-second maximum staleness requirement.
- Q: What UI component library is used for frontend styling? → A: Material UI (MUI v6). All interactive and layout primitives come from `@mui/material`; Tailwind CSS is not used. MUI's `createTheme` API provides the design system foundation.
- Q: When Redis is unavailable, should API endpoints return an error or fall back to the database? → A: Fall back to direct PostgreSQL queries on cache miss; Redis unavailability is transparent to read clients with no 5xx errors (FR-024).
- Q: How are stop, route, and trip IDs namespaced to prevent collision between multiple agencies? → A: Composite primary key using (agency_id + the feed's raw ID string); all feed-sourced entities carry an explicit agency_id as part of their primary identifier.
- Q: What should the ingestion job do when a GTFS ZIP download is malformed or incomplete? → A: Fail fast — abort the ingest before touching the database, log at ERROR level, and preserve the agency's existing data unchanged (FR-025).
- Q: When a realtime vehicle position references a trip_id absent from the static dataset, what should happen? → A: Log at WARN level and discard the position; unresolvable vehicles are not displayed on the map (FR-026).
- Q: Is route and stop search server-side or client-side, and what matching strategy is used? → A: Server-side SQL ILIKE case-insensitive substring match against name, short name, and stop code; results are paginated via limit/offset (FR-027).

## Out of Scope

- User accounts, saved routes, or personalised push alerts
- WebSocket-based live push updates (periodic polling is sufficient for this phase)
- GraphQL API layer (REST only)
- Turn-by-turn navigation or multi-modal trip planning across agencies
- Predictive arrival-time modelling beyond what the GTFS Realtime feed natively provides
- Native iOS or Android applications (responsive web only)
- Fare information, trip costs, or payment integration
- Self-hosted OpenStreetMap tile server
- Multi-region route planning (journeys that cross agency boundaries)
