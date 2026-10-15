import { transit_realtime } from 'gtfs-realtime-bindings';
import { tripRealtimeField, type StopRealtime, type TripRealtime } from '@transit-tracker/shared';
import { has, optionalEpoch, optionalInt, optionalString } from './proto';

const TripRel = transit_realtime.TripDescriptor.ScheduleRelationship;
const StopRel = transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship;
// DELETED (7) was added to the spec after the bindings we use were generated.
const TRIP_DELETED = 7;

/** What the parser needs to know about a static GTFS trip. */
export type StaticTrip = { routeId: string; directionId: number | null };

export type ParsedTripUpdates = {
  /** Trips in static GTFS, keyed by tripRealtimeField. Canceled trips have `canceled: true`. */
  tripUpdates: Map<string, TripRealtime>;
  /**
   * ADDED/DUPLICATED trips and trip_ids not in static GTFS, keyed by
   * tripRealtimeField (plus start_time for DUPLICATED, which reuse the original trip_id).
   */
  addedTrips: Map<string, TripRealtime>;
  /** Feed header timestamp (epoch seconds), or null if the feed didn't send one. */
  feedTimestamp: number | null;
  stats: { tripUpdates: number; added: number; canceled: number; skippedStops: number };
};

/**
 * Parses a GTFS-RT TripUpdates feed.
 *
 * @param staticTrips trips present in static GTFS, by trip_id. A trip_id not
 *   in this map is treated as ADDED. Pass null when it is unknown (static GTFS
 *   not loaded yet); then only an explicit ADDED relationship marks a trip as added.
 */
export function parseTripUpdates(
  feed: transit_realtime.IFeedMessage,
  staticTrips: ReadonlyMap<string, StaticTrip> | null,
  nowEpochS: number = Math.floor(Date.now() / 1000),
): ParsedTripUpdates {
  const feedTimestamp = optionalEpoch(feed.header, 'timestamp');
  const result: ParsedTripUpdates = {
    tripUpdates: new Map(),
    addedTrips: new Map(),
    feedTimestamp,
    stats: { tripUpdates: 0, added: 0, canceled: 0, skippedStops: 0 },
  };

  for (const entity of feed.entity ?? []) {
    if (entity.isDeleted) continue;
    const tu = entity.tripUpdate;
    const trip = tu?.trip;
    const tripId = optionalString(trip, 'tripId');
    if (!tu || !trip || !tripId) continue;

    const relationship = has(trip, 'scheduleRelationship')
      ? (trip.scheduleRelationship as number)
      : TripRel.SCHEDULED;
    const base = {
      tripId,
      routeId: optionalString(trip, 'routeId'),
      directionId: optionalInt(trip, 'directionId'),
      startDate: optionalString(trip, 'startDate'),
      feedTimestamp: feedTimestamp ?? nowEpochS,
    };
    const field = tripRealtimeField(tripId, base.startDate);

    if (relationship === TripRel.CANCELED || relationship === TRIP_DELETED) {
      result.tripUpdates.set(field, { ...base, canceled: true, stops: [] });
      continue;
    }

    const stops = parseStopTimeUpdates(tu.stopTimeUpdate ?? []);
    if (stops.length === 0) continue;

    if (relationship === TripRel.DUPLICATED) {
      // A copy of a static trip at another time. Its new trip_id lives in
      // trip_properties, which our bindings don't decode, so key it by the
      // original trip_id plus start_time and take the route from static GTFS.
      const original = staticTrips?.get(tripId);
      base.routeId ??= original?.routeId ?? null;
      base.directionId ??= original?.directionId ?? null;
      if (!base.routeId) continue;
      const startTime = optionalString(trip, 'startTime') ?? '';
      result.addedTrips.set(`${field}#${startTime}`, { ...base, canceled: false, stops });
      continue;
    }

    const isAdded =
      relationship === TripRel.ADDED || (staticTrips !== null && !staticTrips.has(tripId));

    if (isAdded) {
      // Without a route the reader can't place an added trip on any stop board.
      if (!base.routeId) continue;
      result.addedTrips.set(field, { ...base, canceled: false, stops });
    } else {
      result.tripUpdates.set(field, { ...base, canceled: false, stops });
    }
  }

  for (const trip of result.tripUpdates.values()) {
    if (trip.canceled) result.stats.canceled++;
    else result.stats.tripUpdates++;
    result.stats.skippedStops += trip.stops.filter((s) => s.skipped).length;
  }
  for (const trip of result.addedTrips.values()) {
    result.stats.added++;
    result.stats.skippedStops += trip.stops.filter((s) => s.skipped).length;
  }

  return result;
}

function parseStopTimeUpdates(
  updates: transit_realtime.TripUpdate.IStopTimeUpdate[],
): StopRealtime[] {
  const stops: StopRealtime[] = [];

  for (const stu of updates) {
    const stopSequence = optionalInt(stu, 'stopSequence');
    const stopId = optionalString(stu, 'stopId');
    if (stopSequence === null && stopId === null) continue;

    const relationship = has(stu, 'scheduleRelationship')
      ? (stu.scheduleRelationship as number)
      : StopRel.SCHEDULED;
    // NO_DATA means "no realtime info for this stop": keep it with no times so
    // the reader uses the schedule. Dropping it would make the reader think the
    // vehicle had already passed it.
    if (relationship === StopRel.NO_DATA) {
      stops.push({
        stopSequence,
        stopId,
        arrivalTime: null,
        departureTime: null,
        delay: null,
        skipped: false,
        uncertainty: null,
      });
      continue;
    }

    const arrival = stu.arrival;
    const departure = stu.departure;
    stops.push({
      stopSequence,
      stopId,
      arrivalTime: optionalEpoch(arrival, 'time'),
      departureTime: optionalEpoch(departure, 'time'),
      delay: optionalInt(arrival, 'delay') ?? optionalInt(departure, 'delay'),
      skipped: relationship === StopRel.SKIPPED,
      uncertainty: optionalInt(arrival, 'uncertainty') ?? optionalInt(departure, 'uncertainty'),
    });
  }

  // The spec requires updates sorted by stop_sequence, but don't trust it.
  // Only sort when every entry has a sequence; otherwise keep feed order.
  if (stops.every((s) => s.stopSequence !== null)) {
    stops.sort((a, b) => a.stopSequence! - b.stopSequence!);
  }
  return stops;
}
