// All named configuration constants — no magic values in service code

// Default search radius for nearby stops queries (metres)
export const NEARBY_DEFAULT_RADIUS_M = 500;
// Hard upper bound on caller-supplied radius for nearby stops queries (metres)
export const NEARBY_MAX_RADIUS_M = 5000;

// Vehicle realtime cache TTL (seconds) — ≤30s staleness
// AN-01 resolution: aligned to 30s (FR-008 updated accordingly)
export const VEHICLE_CACHE_TTL_S = 30;

// Alerts cache TTL (seconds) — ≤30s staleness
export const ALERTS_CACHE_TTL_S = 30;

// TripUpdate realtime delay cache TTL (seconds) — hash key per agency
export const TRIP_UPDATE_CACHE_TTL_S = 20;

// API response cache TTL for arrival lists (seconds) — short TTL keeps
// countdown timers accurate while avoiding redundant DB queries
export const API_CACHE_ARRIVALS_TTL_S = 20;
// API response cache TTL for route lists (seconds) — routes change infrequently
// so a longer TTL is safe and reduces load on the stop_times index
export const API_CACHE_ROUTES_TTL_S = 86400; // 1 day
// API response cache TTL for nearby stop results (seconds) — slightly longer
// than arrivals TTL; geo results are stable unless the user moves significantly
export const API_CACHE_NEARBY_TTL_S = 45;

// How often the worker polls each agency's realtime GTFS-RT feed (milliseconds)
export const REALTIME_POLL_INTERVAL_MS = 15_000;

// Default page size for stop search results
export const DEFAULT_SEARCH_LIMIT = 20;
// Maximum page size a caller may request for stop search results
export const MAX_SEARCH_LIMIT = 100;
