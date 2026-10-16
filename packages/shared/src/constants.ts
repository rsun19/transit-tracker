export const NEARBY_DEFAULT_RADIUS_M = 500;
export const NEARBY_MAX_RADIUS_M = 5000;
export const VEHICLE_CACHE_TTL_S = 30;
export const ALERTS_CACHE_TTL_S = 30;
// About 3x the realtime poll interval, so one or two failed polls don't blank
// out predictions, but a dead feed stops being served within a minute.
export const TRIP_UPDATE_CACHE_TTL_S = 60;
// A GTFS-RT feed whose header timestamp is older than this is treated as stale
// and not written to Redis.
export const REALTIME_FEED_MAX_AGE_S = 120;
// A feed timestamp further in the future than this is a bad clock (or ms sent
// as seconds) and is rejected, so it can't block every later write.
export const REALTIME_FEED_MAX_FUTURE_S = 60;
export const REALTIME_FETCH_TIMEOUT_MS = 10_000;
// Arrivals carry live predictions, so cache them only briefly on top of the
// worker poll and the frontend poll.
export const API_CACHE_ARRIVALS_TTL_S = 5;
export const API_CACHE_SEARCH_TTL_S = 15;
// How far back to look for scheduled trips that may still be coming because
// they are running late.
export const ARRIVALS_LATE_WINDOW_S = 90 * 60;
// Arrivals whose effective time (prediction, else schedule) is further in the
// past than this are dropped.
export const ARRIVAL_PAST_GRACE_S = 30;
// |predicted - scheduled| below this counts as on time.
export const ARRIVAL_ON_TIME_THRESHOLD_S = 60;
export const API_CACHE_ROUTES_TTL_S = 3600;
// Trip detail is keyed by service date, or "current" when the caller gives
// none; short enough that "current" moves to today's run within a minute.
export const API_CACHE_TRIP_TTL_S = 60;
export const API_CACHE_NEARBY_TTL_S = 45;
export const REALTIME_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;

// Radius in degrees used to consider two bus stops as co-located (~150 m).
// Longitude deltas are scaled by cos(mean_latitude) before comparison to
// account for converging meridians. At 42°N (Boston), cos(42°) ≈ 0.743.
export const STOP_MERGE_RADIUS_DEG = 150 / 111_320;
