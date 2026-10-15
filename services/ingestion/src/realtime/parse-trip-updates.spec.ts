/// <reference types="jest" />
import { transit_realtime } from 'gtfs-realtime-bindings';
import { parseTripUpdates } from './parse-trip-updates';
import { FEED_TIMESTAMP as T, STATIC_TRIPS, tripUpdatesFeed } from './__fixtures__/feeds';

describe('parseTripUpdates()', () => {
  const parsed = parseTripUpdates(tripUpdatesFeed(), STATIC_TRIPS);
  const scheduled = parsed.tripUpdates.get('T-SCHED@20261014')!;
  const stopAt = (seq: number) => scheduled.stops.find((s) => s.stopSequence === seq)!;

  it('reads the feed header timestamp', () => {
    expect(parsed.feedTimestamp).toBe(T);
    expect(scheduled.feedTimestamp).toBe(T);
  });

  it('keeps trip descriptor fields, including direction 0', () => {
    expect(scheduled).toMatchObject({
      tripId: 'T-SCHED',
      routeId: 'Red',
      directionId: 0,
      startDate: '20261014',
      canceled: false,
    });
  });

  it('leaves delay null when the feed omits it, instead of defaulting to 0', () => {
    expect(stopAt(2).delay).toBeNull();
    expect(stopAt(2).arrivalTime).toBe(T + 180);
  });

  it('keeps a delay the feed actually sends', () => {
    expect(stopAt(4).delay).toBe(120);
  });

  it('stores arrival and departure times separately', () => {
    expect(stopAt(2)).toMatchObject({ arrivalTime: T + 180, departureTime: T + 200 });
  });

  it('keeps a departure-only first stop', () => {
    expect(stopAt(1)).toMatchObject({ arrivalTime: null, departureTime: T + 60 });
  });

  it('keeps the realtime child-platform stop_id', () => {
    expect(stopAt(1).stopId).toBe('Alewife-01');
  });

  it('marks SKIPPED stops instead of dropping them or giving them a delay', () => {
    expect(stopAt(3)).toEqual({
      stopSequence: 3,
      stopId: '70065',
      arrivalTime: null,
      departureTime: null,
      delay: null,
      skipped: true,
      uncertainty: null,
    });
  });

  it('keeps NO_DATA stops with no times, so the reader uses the schedule there', () => {
    expect(stopAt(5)).toEqual({
      stopSequence: 5,
      stopId: '70069',
      arrivalTime: null,
      departureTime: null,
      delay: null,
      skipped: false,
      uncertainty: null,
    });
  });

  it('reads uncertainty', () => {
    expect(stopAt(2).uncertainty).toBe(60);
    expect(stopAt(4).uncertainty).toBeNull();
  });

  it('orders stops by stop_sequence', () => {
    expect(scheduled.stops.map((s) => s.stopSequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('writes CANCELED trips with canceled: true and no stops', () => {
    expect(parsed.tripUpdates.get('T-CANCEL')).toMatchObject({ canceled: true, stops: [] });
  });

  it('routes ADDED trips to addedTrips with route and direction', () => {
    expect(parsed.tripUpdates.has('T-ADDED')).toBe(false);
    expect(parsed.addedTrips.get('T-ADDED')).toMatchObject({
      routeId: 'Red',
      directionId: null,
      canceled: false,
      stops: [{ stopSequence: 10, stopId: '70061', arrivalTime: T + 300 }],
    });
  });

  it('treats a trip_id missing from static GTFS as added', () => {
    expect(parsed.tripUpdates.has('T-UNKNOWN')).toBe(false);
    expect(parsed.addedTrips.get('T-UNKNOWN')).toMatchObject({ routeId: 'Orange', directionId: 1 });
  });

  it('stores a DUPLICATED trip under trip_id + start_time, with the route from static GTFS', () => {
    expect(parsed.tripUpdates.get('T-SCHED@20261014')!.stops[0].departureTime).toBe(T + 60);
    expect(parsed.addedTrips.get('T-SCHED@20261014#25:10:00')).toMatchObject({
      tripId: 'T-SCHED',
      routeId: 'Red',
      directionId: 0,
      stops: [{ departureTime: T + 900 }],
    });
  });

  it('keeps the same trip_id on two service days apart', () => {
    expect(parsed.tripUpdates.get('T-OVERNIGHT@20261013')!.stops[0].arrivalTime).toBe(T + 30);
    expect(parsed.tripUpdates.get('T-OVERNIGHT@20261014')!.stops[0].arrivalTime).toBe(T + 3000);
  });

  it('skips added trips with no route_id', () => {
    expect(parsed.addedTrips.has('T-ADDED-NO-ROUTE')).toBe(false);
  });

  it('only uses the explicit ADDED relationship when the static trip set is unknown', () => {
    const unknownSet = parseTripUpdates(tripUpdatesFeed(), null);
    expect(unknownSet.tripUpdates.has('T-UNKNOWN')).toBe(true);
    expect(unknownSet.addedTrips.has('T-UNKNOWN')).toBe(false);
    expect(unknownSet.addedTrips.has('T-ADDED')).toBe(true);
  });

  it('counts trip updates, added, canceled and skipped stops', () => {
    expect(parsed.stats).toEqual({ tripUpdates: 3, added: 3, canceled: 1, skippedStops: 1 });
  });

  it('falls back to now when the feed has no header timestamp', () => {
    const feed = transit_realtime.FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0' },
      entity: [
        {
          id: '1',
          tripUpdate: {
            trip: { tripId: 'T-SCHED' },
            stopTimeUpdate: [{ stopId: '70063', arrival: { time: T } }],
          },
        },
      ],
    });
    const result = parseTripUpdates(feed, STATIC_TRIPS, 42);
    expect(result.feedTimestamp).toBeNull();
    expect(result.tripUpdates.get('T-SCHED')!.feedTimestamp).toBe(42);
    expect(result.tripUpdates.get('T-SCHED')!.stops[0].stopSequence).toBeNull();
  });
});
