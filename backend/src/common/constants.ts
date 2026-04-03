// All named configuration constants — no magic values in service code

export const NEARBY_DEFAULT_RADIUS_M = 500;
export const NEARBY_MAX_RADIUS_M = 5000;

// Vehicle realtime cache TTL (seconds) — matches SC-004 (≤30s staleness)
// AN-01 resolution: aligned to 30s (FR-008 updated accordingly)
export const VEHICLE_CACHE_TTL_S = 30;

// Alerts cache TTL (seconds)
export const ALERTS_CACHE_TTL_S = 30;

// TripUpdate realtime delay cache TTL (seconds) — hash key per agency
export const TRIP_UPDATE_CACHE_TTL_S = 30;

// API response cache TTLs (seconds)
export const API_CACHE_DEPARTURES_TTL_S = 20;
export const API_CACHE_ROUTES_TTL_S = 300;
export const API_CACHE_NEARBY_TTL_S = 45;

// Realtime feed polling interval (milliseconds)
export const REALTIME_POLL_INTERVAL_MS = 15_000;

// Search pagination defaults
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
