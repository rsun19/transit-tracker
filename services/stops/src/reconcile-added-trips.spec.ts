/// <reference types="jest" />
import { RECONCILE_WINDOW_S, reconcileAddedTrips } from './reconcileAddedTrips';
import type { MergedArrival } from './merge-realtime';
import type { AddedTripEntry } from './stops.types';

// Helpers ────────────────────────────────────────────────────────────────────

const T0 = new Date('2026-04-03T13:00:00Z').getTime() / 1000; // reference epoch seconds
const SUBWAY = 1;
const BUS = 3;

function sched(overrides: Partial<MergedArrival> = {}): MergedArrival {
  const scheduledEpoch = overrides.scheduledEpoch ?? T0;
  const iso = new Date(scheduledEpoch * 1000).toISOString();
  return {
    tripId: 'trip-1',
    routeId: 'Red',
    routeShortName: 'RL',
    routeLongName: 'Red Line',
    headsign: 'Alewife',
    directionId: 1,
    realtimeArrival: iso,
    realtimeDelaySeconds: null,
    hasRealtime: false,
    scheduledTime: iso,
    predictedTime: null,
    status: 'scheduled',
    uncertaintySeconds: null,
    effectiveTime: scheduledEpoch,
    leavesAt: scheduledEpoch,
    scheduledEpoch,
    serviceDate: '20260403',
    routeType: SUBWAY,
    pickupType: null,
    passed: false,
    ...overrides,
  };
}

function added(overrides: Partial<AddedTripEntry> = {}): AddedTripEntry {
  return {
    trip: {
      tripId: 'ADDED-001',
      routeId: 'Red',
      directionId: 1,
      headsign: null,
    },
    predictedTime: T0, // same as scheduled by default
    leavesAt: overrides.predictedTime ?? T0,
    uncertaintySeconds: null,
    routeType: SUBWAY,
    routeShortName: 'RL',
    routeLongName: 'Red Line',
    headsignFallback: 'Alewife',
    ...overrides,
  };
}

// Tests ──────────────────────────────────────────────────────────────────────

describe('reconcileAddedTrips()', () => {
  describe('basic reconciliation', () => {
    it('merges ADDED trip into nearest scheduled slot and sets the prediction', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + 30 })]); // 30 s late

      expect(deps[0]).toMatchObject({
        hasRealtime: true,
        realtimeDelaySeconds: 30,
        status: 'on_time',
        predictedTime: new Date((T0 + 30) * 1000).toISOString(),
        realtimeArrival: new Date((T0 + 30) * 1000).toISOString(),
        effectiveTime: T0 + 30,
      });
    });

    it('computes negative delay when ADDED trip arrives early', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 - 90 })]); // 90 s early

      expect(deps[0].realtimeDelaySeconds).toBe(-90);
      expect(deps[0].status).toBe('early');
    });

    it('does not append a new row when a match is found', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + 60 })]);

      expect(deps).toHaveLength(1);
    });
  });

  describe('window boundary', () => {
    it('matches ADDED trip exactly at the window boundary (5 min)', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + RECONCILE_WINDOW_S })]);

      expect(deps[0].hasRealtime).toBe(true);
    });

    it('appends ADDED trip as new row when beyond the window', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + RECONCILE_WINDOW_S + 1 })]);

      expect(deps).toHaveLength(2);
      expect(deps[0].hasRealtime).toBe(false); // original untouched
      expect(deps[1].tripId).toBe('ADDED-001');
    });
  });

  describe('route / direction / mode filtering', () => {
    it('does not match across different routes', () => {
      const deps = [sched({ routeId: 'Red' })];
      reconcileAddedTrips(deps, [added({ trip: { ...added().trip, routeId: 'Blue' } })]);

      expect(deps[0].hasRealtime).toBe(false);
      expect(deps).toHaveLength(2); // appended as new
    });

    it('does not match across different directionId values', () => {
      const deps = [sched({ directionId: 0 })];
      reconcileAddedTrips(deps, [added({ trip: { ...added().trip, directionId: 1 } })]);

      expect(deps[0].hasRealtime).toBe(false);
      expect(deps).toHaveLength(2);
    });

    it('never lets a bus ADDED trip hide a scheduled trip', () => {
      const deps = [sched({ routeId: '1', routeType: BUS })];
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, routeId: '1' }, routeType: BUS, predictedTime: T0 + 10 }),
      ]);

      expect(deps).toHaveLength(2);
      expect(deps[0].hasRealtime).toBe(false);
      expect(deps[1].status).toBe('added');
    });

    it('matches on light rail (route_type 0)', () => {
      const deps = [sched({ routeId: 'Green-B', routeType: 0 })];
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, routeId: 'Green-B' }, routeType: 0 }),
      ]);

      expect(deps).toHaveLength(1);
      expect(deps[0].hasRealtime).toBe(true);
    });

    it('does not match a scheduled row that already has a prediction or is canceled', () => {
      const deps = [
        sched({ tripId: 'predicted', hasRealtime: true, status: 'on_time' }),
        sched({ tripId: 'canceled', status: 'canceled' }),
      ];
      reconcileAddedTrips(deps, [added()]);

      expect(deps).toHaveLength(3);
    });

    it('does not claim a row the vehicle has already passed', () => {
      // The passed row is filtered out later; claiming it would hide the ADDED trip.
      const deps = [sched({ tripId: 'passed', scheduledEpoch: T0 - 120, passed: true })];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + 120 })]);

      expect(deps).toHaveLength(2);
      expect(deps[0].hasRealtime).toBe(false);
      expect(deps[1]).toMatchObject({ tripId: 'ADDED-001', status: 'added', passed: false });
    });
  });

  describe('one-to-one mapping', () => {
    it('each scheduled slot is consumed by at most one ADDED trip', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, tripId: 'ADDED-A' }, predictedTime: T0 + 20 }),
        added({ trip: { ...added().trip, tripId: 'ADDED-B' }, predictedTime: T0 + 40 }),
      ]);

      // Only one match; the second becomes a new row
      expect(deps).toHaveLength(2);
      expect(deps[0].realtimeDelaySeconds).toBe(20); // first ADDED wins (sorted ascending)
    });
  });

  describe('high-frequency route (ascending sort correctness)', () => {
    it('assigns each ADDED trip to its nearest earlier slot on 2-min headways', () => {
      // Scheduled: 13:00, 13:02, 13:04
      const deps = [
        sched({ tripId: 'trip-A', scheduledEpoch: T0 }),
        sched({ tripId: 'trip-B', scheduledEpoch: T0 + 2 * 60 }),
        sched({ tripId: 'trip-C', scheduledEpoch: T0 + 4 * 60 }),
      ];
      // ADDED (passed in reversed order to verify sort):
      //   ADDED-X ≈ 13:04:15 → should match trip-C
      //   ADDED-Y ≈ 13:02:20 → should match trip-B
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, tripId: 'ADDED-X' }, predictedTime: T0 + 4 * 60 + 15 }),
        added({ trip: { ...added().trip, tripId: 'ADDED-Y' }, predictedTime: T0 + 2 * 60 + 20 }),
      ]);

      expect(deps).toHaveLength(3); // no appended rows
      expect(deps[0].hasRealtime).toBe(false); // trip-A untouched
      expect(deps[1].realtimeDelaySeconds).toBe(20); // trip-B ← ADDED-Y
      expect(deps[2].realtimeDelaySeconds).toBe(15); // trip-C ← ADDED-X
    });
  });

  describe('headsign fallback', () => {
    it('applies headsignFallback when scheduled trip has no headsign', () => {
      const deps = [sched({ headsign: null })];
      reconcileAddedTrips(deps, [added({ headsignFallback: 'Alewife' })]);

      expect(deps[0].headsign).toBe('Alewife');
    });

    it('prefers trip.headsign over headsignFallback', () => {
      const deps = [sched({ headsign: null })];
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, headsign: 'Braintree' }, headsignFallback: 'Alewife' }),
      ]);

      expect(deps[0].headsign).toBe('Braintree');
    });

    it('does not overwrite existing headsign on scheduled trip', () => {
      const deps = [sched({ headsign: 'Alewife' })];
      reconcileAddedTrips(deps, [
        added({ trip: { ...added().trip, headsign: 'Braintree' }, headsignFallback: 'Somewhere' }),
      ]);

      expect(deps[0].headsign).toBe('Alewife');
    });

    it('uses headsignFallback on appended new-service rows', () => {
      const deps: MergedArrival[] = [];
      reconcileAddedTrips(deps, [added({ headsignFallback: 'Alewife' })]);

      expect(deps[0].headsign).toBe('Alewife');
    });
  });

  describe('appended extra service', () => {
    it('has a prediction, no schedule, no delay, and status "added"', () => {
      const deps: MergedArrival[] = [];
      reconcileAddedTrips(deps, [added({ predictedTime: T0 + 120, uncertaintySeconds: 60 })]);

      expect(deps[0]).toMatchObject({
        hasRealtime: true,
        scheduledTime: null,
        scheduledEpoch: null,
        realtimeDelaySeconds: null,
        status: 'added',
        uncertaintySeconds: 60,
        predictedTime: new Date((T0 + 120) * 1000).toISOString(),
        effectiveTime: T0 + 120,
      });
    });
  });

  describe('edge cases', () => {
    it('returns arrivals unchanged when addedEntries is empty', () => {
      const deps = [sched()];
      reconcileAddedTrips(deps, []);
      expect(deps).toHaveLength(1);
      expect(deps[0].hasRealtime).toBe(false);
    });

    it('appends all entries as new rows when arrivals is empty', () => {
      const deps: MergedArrival[] = [];
      reconcileAddedTrips(deps, [
        added(),
        added({ trip: { ...added().trip, tripId: 'ADDED-002' }, predictedTime: T0 + 120 }),
      ]);
      expect(deps).toHaveLength(2);
      expect(deps.every((d) => d.hasRealtime)).toBe(true);
    });

    it('does not mutate the original addedEntries array order', () => {
      const deps = [sched()];
      const entries = [
        added({ trip: { ...added().trip, tripId: 'ADDED-Z' }, predictedTime: T0 + 200 }),
        added({ trip: { ...added().trip, tripId: 'ADDED-A' }, predictedTime: T0 + 10 }),
      ];
      const originalOrder = entries.map((e) => e.trip.tripId);
      reconcileAddedTrips(deps, entries);
      expect(entries.map((e) => e.trip.tripId)).toEqual(originalOrder);
    });
  });
});
