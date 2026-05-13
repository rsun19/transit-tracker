export const NEARBY_DEFAULT_RADIUS_M = 500;
export const NEARBY_MAX_RADIUS_M = 5000;
export const VEHICLE_CACHE_TTL_S = 30;
export const ALERTS_CACHE_TTL_S = 30;
export const TRIP_UPDATE_CACHE_TTL_S = 20;
export const API_CACHE_ARRIVALS_TTL_S = 15;
export const API_CACHE_ROUTES_TTL_S = 3600;
export const API_CACHE_NEARBY_TTL_S = 45;
export const REALTIME_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;

// Radius in degrees used to consider two bus stops as co-located (~150 m).
// Longitude deltas are scaled by cos(mean_latitude) before comparison to
// account for converging meridians. At 42°N (Boston), cos(42°) ≈ 0.743.
export const STOP_MERGE_RADIUS_DEG = 150 / 111_320;
