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
