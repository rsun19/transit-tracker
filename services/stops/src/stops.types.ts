export interface StopRouteRef {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
}

export interface StopResponse {
  id: string;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  distanceMetres?: number;
  routes?: StopRouteRef[];
}

/**
 * - scheduled: no prediction, the schedule is shown
 * - on_time / late / early: predicted vs. scheduled (ARRIVAL_ON_TIME_THRESHOLD_S)
 * - canceled / skipped: the trip or this stop won't be served
 * - added: extra service with no scheduled counterpart
 */
export type ArrivalStatus =
  | 'scheduled'
  | 'on_time'
  | 'late'
  | 'early'
  | 'canceled'
  | 'skipped'
  | 'added';

export interface ArrivalResponse {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  headsign: string | null;
  directionId: number | null;
  /** Predicted time if there is one, otherwise the scheduled time (ISO). Kept for compatibility. */
  realtimeArrival: string;
  /** predicted - scheduled, in seconds; null without a prediction or a schedule. */
  realtimeDelaySeconds: number | null;
  /** True only when an actual prediction exists. */
  hasRealtime: boolean;
  /** Scheduled arrival (else departure, at a trip's first stop), ISO. Null for added trips. */
  scheduledTime: string | null;
  /** Predicted arrival (else departure, at a trip's first stop), ISO. */
  predictedTime: string | null;
  status: ArrivalStatus;
  uncertaintySeconds: number | null;
}

export interface AddedTripEntry {
  trip: {
    tripId: string;
    routeId: string;
    directionId: number | null;
    headsign: string | null;
  };
  /** Predicted arrival (else departure) at this stop, epoch seconds. */
  predictedTime: number;
  /** Predicted departure (else arrival) at this stop, epoch seconds. */
  leavesAt: number;
  uncertaintySeconds: number | null;
  routeType: number | null;
  routeShortName: string | null;
  routeLongName: string | null;
  headsignFallback: string | null;
}
