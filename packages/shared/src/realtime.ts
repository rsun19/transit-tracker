// Shapes and Redis keys for GTFS-RT data written by the ingestion worker and
// read by the API services. Both sides must use these builders so the key
// names can't drift apart.

export type StopRealtime = {
  stopSequence: number | null;
  /** Realtime stop_id; may be a child platform of the static stop (e.g. "Alewife-01"). */
  stopId: string | null;
  /** Epoch seconds. */
  arrivalTime: number | null;
  /** Epoch seconds. */
  departureTime: number | null;
  /** Seconds; only set when the feed actually sends a delay. Never defaulted to 0. */
  delay: number | null;
  skipped: boolean;
  uncertainty: number | null;
};

export type TripRealtime = {
  tripId: string;
  routeId: string | null;
  directionId: number | null;
  /** YYYYMMDD, from the trip descriptor. */
  startDate: string | null;
  canceled: boolean;
  /** Ordered by stopSequence. Empty when canceled. */
  stops: StopRealtime[];
  /** Feed header timestamp, epoch seconds. */
  feedTimestamp: number;
};

export type AlertActivePeriod = {
  /** Epoch seconds; null means open-ended. */
  start: number | null;
  end: number | null;
};

export type AlertInformedEntity = {
  routeId: string | null;
  routeType: number | null;
  stopId: string | null;
  tripId: string | null;
};

export type ServiceAlert = {
  alertId: string;
  headerText: string;
  descriptionText: string;
  effect: string;
  cause: string;
  /**
   * GTFS-RT effect_detail, the agency's finer category (MBTA: DELAY,
   * SUSPENSION, SHUTTLE, ELEVATOR_CLOSURE, PARKING_ISSUE, ...). MBTA files
   * delays as effect OTHER_EFFECT, so this is what identifies them.
   */
  effectDetail?: string | null;
  /** GTFS-RT severity_level: SEVERE, WARNING, INFO or UNKNOWN_SEVERITY. Absent in data written before it was added. */
  severityLevel?: string;
  activePeriods: AlertActivePeriod[];
  informedEntities: AlertInformedEntity[];
  routeIds: string[];
  /**
   * Stop ids to match against. Includes each informed stop plus its parent
   * station and child platforms, so a lookup by either level matches.
   */
  stopIds: string[];
  tripIds: string[];
};

/**
 * Hash field for a trip: "trip_id@YYYYMMDD" when the feed gives a start date,
 * else the bare trip_id. Keeps the same trip_id on two service days (overnight
 * service) from overwriting each other.
 */
export const tripRealtimeField = (tripId: string, startDate: string | null): string =>
  startDate ? `${tripId}@${startDate}` : tripId;

/** Hash: tripRealtimeField -> JSON TripRealtime, for trips in static GTFS (including canceled ones). */
export const tripUpdatesKey = (agencyKey: string): string => `trip_updates:v2:${agencyKey}`;

/** Hash: unique per trip instance -> JSON TripRealtime, for ADDED/DUPLICATED trips and trip_ids not in static GTFS. */
export const addedTripsKey = (agencyKey: string): string => `added_trips:v2:${agencyKey}`;

/** String: JSON ServiceAlert[]. */
export const alertsKey = (agencyKey: string): string => `alerts:${agencyKey}`;

// Effects that change whether or where a rider can catch the service.
const URGENT_EFFECTS = new Set([
  'NO_SERVICE',
  'REDUCED_SERVICE',
  'SIGNIFICANT_DELAYS',
  'DETOUR',
  'MODIFIED_SERVICE',
  'STOP_MOVED',
]);

// effect_detail values that are disruptions even when `effect` is generic.
const URGENT_EFFECT_DETAILS = new Set([
  'DELAY',
  'SUSPENSION',
  'SHUTTLE',
  'CANCELLATION',
  'STATION_CLOSURE',
  'STOP_CLOSURE',
  'TRACK_CHANGE',
]);

/**
 * True for alerts a rider needs to see right away: service disruptions
 * (by effect or effect_detail), plus anything the agency marks SEVERE.
 * Elevator, escalator, parking and general notices are not urgent.
 */
export function isUrgentAlert(
  alert: Pick<ServiceAlert, 'effect' | 'effectDetail' | 'severityLevel'>,
): boolean {
  return (
    alert.severityLevel === 'SEVERE' ||
    URGENT_EFFECTS.has(alert.effect) ||
    (alert.effectDetail != null && URGENT_EFFECT_DETAILS.has(alert.effectDetail))
  );
}

/** True if an alert names the route as a whole (not just one stop or trip on it). */
export function isRouteWideAlert(
  alert: Pick<ServiceAlert, 'informedEntities'>,
  routeIds: ReadonlySet<string>,
): boolean {
  return (alert.informedEntities ?? []).some(
    (ie) => ie.routeId !== null && routeIds.has(ie.routeId) && !ie.stopId && !ie.tripId,
  );
}

/** An alert with no active periods is always active. */
export function isAlertActive(
  alert: Pick<ServiceAlert, 'activePeriods'>,
  nowEpochS: number,
): boolean {
  const periods = alert.activePeriods ?? [];
  if (periods.length === 0) return true;
  return periods.some(
    (p) => (p.start == null || p.start <= nowEpochS) && (p.end == null || p.end >= nowEpochS),
  );
}
