import {
  ARRIVAL_ON_TIME_THRESHOLD_S,
  tripRealtimeField,
  type StopRealtime,
  type TripRealtime,
} from '@transit-tracker/shared';
import type { ArrivalResponse, ArrivalStatus } from './stops.types';

/** One scheduled stop_time at the requested stop, from the arrivals SQL. */
export type ScheduledRow = {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  routeType: number | null;
  headsign: string | null;
  directionId: number | null;
  stopId: string;
  parentStationId: string | null;
  stopSequence: number;
  /** YYYYMMDD service day the row was expanded for. */
  serviceDate: string;
  /** Epoch seconds. At least one of the two is set. */
  scheduledArrival: number | null;
  scheduledDeparture: number | null;
  pickupType: number | null;
};

/** An arrival plus the fields needed to filter and sort it; strip with toArrivalResponse. */
export type MergedArrival = ArrivalResponse & {
  /** Time shown: predicted arrival (else departure), otherwise the schedule; epoch seconds. */
  effectiveTime: number;
  /**
   * When the vehicle leaves this stop: departure if known, else effectiveTime.
   * A train still at the platform stays listed until then.
   */
  leavesAt: number;
  /** Scheduled arrival (else departure), epoch seconds; null for added trips. */
  scheduledEpoch: number | null;
  /** YYYYMMDD service day of the scheduled row; null for added trips. */
  serviceDate: string | null;
  routeType: number | null;
  pickupType: number | null;
  /** The vehicle is already past this stop (the feed no longer lists it). */
  passed: boolean;
};

const iso = (epochS: number) => new Date(epochS * 1000).toISOString();

export function statusForDelay(delaySeconds: number): ArrivalStatus {
  if (delaySeconds >= ARRIVAL_ON_TIME_THRESHOLD_S) return 'late';
  if (delaySeconds <= -ARRIVAL_ON_TIME_THRESHOLD_S) return 'early';
  return 'on_time';
}

/** Sets a prediction on an arrival. A null delay (no schedule to compare to) means status 'added'. */
export function applyPrediction(
  arrival: MergedArrival,
  predictedTime: number,
  delaySeconds: number | null,
  uncertaintySeconds: number | null,
  leavesAt: number = predictedTime,
): void {
  arrival.predictedTime = iso(predictedTime);
  arrival.realtimeArrival = iso(predictedTime);
  arrival.effectiveTime = predictedTime;
  arrival.leavesAt = Math.max(leavesAt, predictedTime);
  arrival.realtimeDelaySeconds = delaySeconds;
  arrival.hasRealtime = true;
  arrival.uncertaintySeconds = uncertaintySeconds;
  arrival.status = delaySeconds === null ? 'added' : statusForDelay(delaySeconds);
}

/** Parses one trip_updates:v2 hash value; returns null for anything malformed. */
export function parseTripRealtime(raw: string | null): TripRealtime | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TripRealtime;
    return value && typeof value === 'object' && Array.isArray(value.stops) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Realtime stop_ids that can only be matched through their parent station:
 * the ones the feed sent without a stop_sequence.
 */
export function stopIdsNeedingParent(trips: Iterable<TripRealtime>): string[] {
  const ids = new Set<string>();
  for (const trip of trips) {
    for (const stop of trip.stops) {
      if (stop.stopSequence === null && stop.stopId) ids.add(stop.stopId);
    }
  }
  return [...ids];
}

/**
 * Finds the realtime update for a scheduled row. A realtime stop with a
 * stop_sequence matches only by sequence (loop routes visit a stop twice).
 * One without a sequence matches by stop_id, then by parent station, since
 * the feed often names a child platform (e.g. "Alewife-01" for static "70061").
 */
function findStop(
  stops: StopRealtime[],
  row: ScheduledRow,
  parentOf: ReadonlyMap<string, string>,
): StopRealtime | null {
  const bySequence = stops.find((s) => s.stopSequence === row.stopSequence);
  if (bySequence) return bySequence;
  const unsequenced = stops.filter((s) => s.stopSequence === null && s.stopId);
  return (
    unsequenced.find((s) => s.stopId === row.stopId) ??
    (row.parentStationId
      ? unsequenced.find((s) => parentOf.get(s.stopId!) === row.parentStationId)
      : undefined) ??
    null
  );
}

const allSequenced = (stops: StopRealtime[]) =>
  stops.length > 0 && stops.every((s) => s.stopSequence !== null);

/** The feed drops stops a vehicle has passed, so a sequence before the first listed one is behind it. */
function hasPassed(stops: StopRealtime[], stopSequence: number): boolean {
  if (!allSequenced(stops)) return false;
  return stopSequence < Math.min(...stops.map((s) => s.stopSequence!));
}

/**
 * GTFS-RT delay propagation: a stop the feed leaves out takes the delay of the
 * nearest earlier listed stop. Only possible when that stop sends a delay; a
 * NO_DATA stop (no delay) stops propagation, as the spec requires.
 */
function propagatedDelay(stops: StopRealtime[], stopSequence: number): number | null {
  if (!allSequenced(stops)) return null;
  let previous: StopRealtime | null = null;
  for (const s of stops) {
    if (s.stopSequence! >= stopSequence) break;
    if (!s.skipped) previous = s;
  }
  return previous?.delay ?? null;
}

/**
 * Combines scheduled rows with TripUpdates. The time shown is the arrival,
 * else the departure (first stop), matching what MBTA shows; subway trains
 * often dwell a minute, so departure would read a minute late. Delay is
 * computed as predicted - scheduled, never taken from the feed's (usually
 * absent) delay.
 */
export function mergeRealtime(
  rows: ScheduledRow[],
  realtimeByTrip: ReadonlyMap<string, TripRealtime>,
  parentOf: ReadonlyMap<string, string> = new Map(),
): MergedArrival[] {
  return rows.map((row) => {
    const scheduled = (row.scheduledArrival ?? row.scheduledDeparture)!;
    const scheduledLeaves = row.scheduledDeparture ?? scheduled;
    const arrival: MergedArrival = {
      tripId: row.tripId,
      routeId: row.routeId,
      routeShortName: row.routeShortName,
      routeLongName: row.routeLongName,
      headsign: row.headsign,
      directionId: row.directionId,
      realtimeArrival: iso(scheduled),
      realtimeDelaySeconds: null,
      hasRealtime: false,
      scheduledTime: iso(scheduled),
      predictedTime: null,
      status: 'scheduled',
      uncertaintySeconds: null,
      effectiveTime: scheduled,
      leavesAt: scheduledLeaves,
      scheduledEpoch: scheduled,
      serviceDate: row.serviceDate,
      routeType: row.routeType,
      pickupType: row.pickupType,
      passed: false,
    };

    // The same trip_id can be scheduled on yesterday's and today's service day.
    const trip =
      realtimeByTrip.get(tripRealtimeField(row.tripId, row.serviceDate)) ??
      realtimeByTrip.get(row.tripId);
    if (!trip || (trip.startDate && trip.startDate !== row.serviceDate)) return arrival;
    if (trip.canceled) {
      arrival.status = 'canceled';
      return arrival;
    }

    const stop = findStop(trip.stops, row, parentOf);
    if (!stop) {
      arrival.passed = hasPassed(trip.stops, row.stopSequence);
      const delay = arrival.passed ? null : propagatedDelay(trip.stops, row.stopSequence);
      if (delay !== null) {
        applyPrediction(arrival, scheduled + delay, delay, null, scheduledLeaves + delay);
      }
      return arrival;
    }
    if (stop.skipped) {
      arrival.status = 'skipped';
      return arrival;
    }

    // Compare like with like: an arrival prediction against the scheduled arrival.
    let predicted: number;
    let reference: number;
    let leaves: number;
    if (stop.arrivalTime !== null) {
      predicted = stop.arrivalTime;
      reference = row.scheduledArrival ?? scheduled;
      // Arrival-only update: assume the scheduled dwell, shifted by the same delay.
      leaves = stop.departureTime ?? scheduledLeaves + (predicted - reference);
    } else if (stop.departureTime !== null) {
      predicted = stop.departureTime;
      reference = row.scheduledDeparture ?? scheduled;
      leaves = predicted;
    } else if (stop.delay !== null) {
      predicted = scheduled + stop.delay;
      reference = scheduled;
      leaves = scheduledLeaves + stop.delay;
    } else {
      return arrival;
    }

    applyPrediction(arrival, predicted, predicted - reference, stop.uncertainty, leaves);
    return arrival;
  });
}

/**
 * Drops canceled trips, skipped stops, rows with no pickup, stops the vehicle
 * has passed, and anything before the cutoff; then sorts by effective time,
 * keeps each trip's next visit only (loop routes stop here twice), and applies
 * the limit.
 */
export function selectUpcoming(
  arrivals: MergedArrival[],
  cutoffEpochS: number,
  limit: number,
): MergedArrival[] {
  const seenTrips = new Set<string>();
  return arrivals
    .filter(
      (a) =>
        a.status !== 'canceled' &&
        a.status !== 'skipped' &&
        a.pickupType !== 1 &&
        !a.passed &&
        a.leavesAt >= cutoffEpochS,
    )
    .sort((a, b) => a.effectiveTime - b.effectiveTime || a.tripId.localeCompare(b.tripId))
    .filter((a) => {
      const key = `${a.tripId}|${a.serviceDate ?? ''}`;
      if (seenTrips.has(key)) return false;
      seenTrips.add(key);
      return true;
    })
    .slice(0, limit);
}

export function toArrivalResponse(arrival: MergedArrival): ArrivalResponse {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    effectiveTime,
    leavesAt,
    scheduledEpoch,
    serviceDate,
    routeType,
    pickupType,
    passed,
    ...response
  } = arrival;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return response;
}

/**
 * Finds where an ADDED trip boards at the requested stop: the first
 * non-skipped stop that it hasn't left by the cutoff whose stop_id is
 * one of the stop's ids, or whose parent station is the requested station.
 */
export function addedTripStopAt(
  trip: TripRealtime,
  stopIds: ReadonlySet<string>,
  stationIds: ReadonlySet<string>,
  parentOf: ReadonlyMap<string, string>,
  cutoffEpochS: number,
): { predictedTime: number; leavesAt: number; uncertainty: number | null } | null {
  for (const stop of trip.stops) {
    if (stop.skipped || !stop.stopId) continue;
    const parent = parentOf.get(stop.stopId);
    const atStop =
      stopIds.has(stop.stopId) ||
      stationIds.has(stop.stopId) ||
      (parent !== undefined && stationIds.has(parent));
    if (!atStop) continue;
    const predictedTime = stop.arrivalTime ?? stop.departureTime;
    const leavesAt = stop.departureTime ?? stop.arrivalTime;
    if (predictedTime !== null && leavesAt !== null && leavesAt >= cutoffEpochS) {
      return {
        predictedTime,
        leavesAt: Math.max(leavesAt, predictedTime),
        uncertainty: stop.uncertainty,
      };
    }
  }
  return null;
}
