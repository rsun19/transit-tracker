import { transit_realtime } from 'gtfs-realtime-bindings';

export const FEED_TIMESTAMP = 1_792_000_000;
const T = FEED_TIMESTAMP;

/** Round-trips through the wire format so field presence matches a real decoded feed. */
function decode(object: Record<string, unknown>): transit_realtime.FeedMessage {
  const message = transit_realtime.FeedMessage.fromObject(object);
  return transit_realtime.FeedMessage.decode(transit_realtime.FeedMessage.encode(message).finish());
}

const header = { gtfsRealtimeVersion: '2.0', incrementality: 'FULL_DATASET', timestamp: T };

/**
 * One trip each for SCHEDULED, CANCELED, ADDED, DUPLICATED, and a SCHEDULED
 * trip_id that isn't in static GTFS. The scheduled trip has a departure-only
 * first stop on a child platform, a stop with no delay, a SKIPPED stop, a stop
 * with a delay, a trailing NO_DATA stop, and its updates out of stop_sequence
 * order. T-OVERNIGHT appears on two service days.
 */
export const tripUpdatesFeed = (): transit_realtime.FeedMessage =>
  decode({
    header,
    entity: [
      {
        id: '1',
        tripUpdate: {
          trip: {
            tripId: 'T-SCHED',
            routeId: 'Red',
            directionId: 0,
            startDate: '20261014',
            scheduleRelationship: 'SCHEDULED',
          },
          stopTimeUpdate: [
            { stopSequence: 1, stopId: 'Alewife-01', departure: { time: T + 60 } },
            {
              stopSequence: 2,
              stopId: '70063',
              arrival: { time: T + 180, uncertainty: 60 },
              departure: { time: T + 200 },
            },
            { stopSequence: 4, stopId: '70067', arrival: { time: T + 600, delay: 120 } },
            { stopSequence: 3, stopId: '70065', scheduleRelationship: 'SKIPPED' },
            { stopSequence: 5, stopId: '70069', scheduleRelationship: 'NO_DATA' },
          ],
        },
      },
      {
        id: '2',
        tripUpdate: {
          trip: { tripId: 'T-CANCEL', routeId: 'Red', scheduleRelationship: 'CANCELED' },
        },
      },
      {
        id: '3',
        tripUpdate: {
          trip: { tripId: 'T-ADDED', routeId: 'Red', scheduleRelationship: 'ADDED' },
          stopTimeUpdate: [{ stopSequence: 10, stopId: '70061', arrival: { time: T + 300 } }],
        },
      },
      {
        id: '4',
        tripUpdate: {
          trip: { tripId: 'T-UNKNOWN', routeId: 'Orange', directionId: 1 },
          stopTimeUpdate: [{ stopSequence: 1, stopId: 'Forest Hills-01', departure: { time: T } }],
        },
      },
      {
        id: '5',
        tripUpdate: {
          trip: { tripId: 'T-ADDED-NO-ROUTE', scheduleRelationship: 'ADDED' },
          stopTimeUpdate: [{ stopSequence: 1, stopId: '70061', arrival: { time: T } }],
        },
      },
      {
        id: '6',
        tripUpdate: {
          trip: {
            tripId: 'T-SCHED',
            startDate: '20261014',
            startTime: '25:10:00',
            scheduleRelationship: 'DUPLICATED',
          },
          stopTimeUpdate: [{ stopSequence: 1, stopId: 'Alewife-01', departure: { time: T + 900 } }],
        },
      },
      {
        id: '7',
        tripUpdate: {
          trip: { tripId: 'T-OVERNIGHT', routeId: 'Red', startDate: '20261013' },
          stopTimeUpdate: [{ stopSequence: 9, stopId: '70061', arrival: { time: T + 30 } }],
        },
      },
      {
        id: '8',
        tripUpdate: {
          trip: { tripId: 'T-OVERNIGHT', routeId: 'Red', startDate: '20261014' },
          stopTimeUpdate: [{ stopSequence: 1, stopId: '70061', arrival: { time: T + 3000 } }],
        },
      },
    ],
  });

export const STATIC_TRIPS: ReadonlyMap<string, { routeId: string; directionId: number | null }> =
  new Map([
    ['T-SCHED', { routeId: 'Red', directionId: 0 }],
    ['T-CANCEL', { routeId: 'Red', directionId: 0 }],
    ['T-OVERNIGHT', { routeId: 'Red', directionId: 1 }],
  ]);

export const alertsFeed = (): transit_realtime.FeedMessage =>
  decode({
    header,
    entity: [
      {
        id: 'A1',
        alert: {
          activePeriod: [{ start: T - 3600, end: T + 3600 }, { start: T + 86_400 }],
          informedEntity: [{ routeId: 'Red', stopId: 'place-alfcl' }],
          effect: 'DETOUR',
          cause: 'CONSTRUCTION',
          headerText: {
            translation: [
              { text: 'Desvío en Alewife', language: 'es' },
              { text: 'Detour at Alewife', language: 'en' },
            ],
          },
          descriptionText: { translation: [{ text: 'Shuttle buses replace service' }] },
        },
      },
      {
        id: 'A2',
        alert: {
          informedEntity: [{ stopId: '70063' }, { trip: { tripId: 'T-SCHED', routeId: 'Red' } }],
          headerText: { translation: [{ text: 'Solo español', language: 'es' }] },
          descriptionText: {
            translation: [
              { text: 'Servicio', language: 'es' },
              { text: 'US English only', language: 'en-US' },
            ],
          },
        },
      },
    ],
  });
