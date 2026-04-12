import { reconcileAddedTrips } from './reconcileAddedTrips';
// Define locally for test (5 min)
const RECONCILE_WINDOW_MS = 5 * 60 * 1000;
import type { ArrivalResponse, AddedTripEntry } from './stops.types';

// Helpers ────────────────────────────────────────────────────────────────────

const T0 = new Date('2026-04-03T13:00:00Z').getTime(); // reference epoch ms

function sched(overrides: Partial<ArrivalResponse> = {}): ArrivalResponse {
  return {
    tripId: 'trip-1',
    routeId: 'Red',
    routeShortName: 'RL',
    routeLongName: 'Red Line',
    headsign: 'Alewife',
    realtimeArrival: new Date(T0).toISOString(),
    realtimeDelaySeconds: null,
    hasRealtime: false,
    directionId: 1,
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
    arrivalTime: T0 / 1000, // same as scheduled by default
    routeShortName: 'RL',
    routeLongName: 'Red Line',
    headsignFallback: 'Alewife',
    ...overrides,
  };
}

// Tests ──────────────────────────────────────────────────────────────────────

describe('reconcileAddedTrips()', () => {
  describe('basic reconciliation', () => {
    it('merges ADDED trip into nearest scheduled slot and sets hasRealtime=true', () => {
      const deps = [sched({ realtimeArrival: new Date(T0).toISOString() })];
      const entries = [added({ arrivalTime: T0 / 1000 + 30 })]; // 30 s late
      reconcileAddedTrips(deps, entries);

      expect(deps[0].hasRealtime).toBe(true);
      expect(deps[0].realtimeDelaySeconds).toBe(30);
    });

    it('computes negative delay when ADDED trip arrives early', () => {
      const deps = [sched({ realtimeArrival: new Date(T0).toISOString() })];
      const entries = [added({ arrivalTime: T0 / 1000 - 90 })]; // 90 s early
      reconcileAddedTrips(deps, entries);

      expect(deps[0].realtimeDelaySeconds).toBe(-90);
    });

    it('does not append a new row when a match is found', () => {
      const deps = [sched()];
      const entries = [added({ arrivalTime: T0 / 1000 + 60 })];
      reconcileAddedTrips(deps, entries);

      expect(deps).toHaveLength(1);
    });
  });

  describe('window boundary', () => {
    it('matches ADDED trip exactly at the window boundary (5 min)', () => {
      const deps = [sched()];
      const entries = [added({ arrivalTime: T0 / 1000 + RECONCILE_WINDOW_MS / 1000 })];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].hasRealtime).toBe(true);
    });

    it('appends ADDED trip as new row when beyond the window', () => {
      const deps = [sched()];
      const entries = [added({ arrivalTime: T0 / 1000 + RECONCILE_WINDOW_MS / 1000 + 1 })];
      reconcileAddedTrips(deps, entries);

      expect(deps).toHaveLength(2);
      expect(deps[0].hasRealtime).toBe(false); // original untouched
      expect(deps[1].tripId).toBe('ADDED-001');
    });
  });

  describe('route / direction filtering', () => {
    it('does not match across different routes', () => {
      const deps = [sched({ routeId: 'Red' })];
      const entries = [added({ trip: { ...added().trip, routeId: 'Blue' } })];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].hasRealtime).toBe(false);
      expect(deps).toHaveLength(2); // appended as new
    });

    it('does not match across different directionId values', () => {
      const deps = [sched({ directionId: 0 })];
      const entries = [added({ trip: { ...added().trip, directionId: 1 } })];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].hasRealtime).toBe(false);
      expect(deps).toHaveLength(2);
    });
  });

  describe('one-to-one mapping', () => {
    it('each scheduled slot is consumed by at most one ADDED trip', () => {
      const deps = [sched({ tripId: 'trip-1', realtimeArrival: new Date(T0).toISOString() })];
      const entries = [
        added({ trip: { ...added().trip, tripId: 'ADDED-A' }, arrivalTime: T0 / 1000 + 20 }),
        added({ trip: { ...added().trip, tripId: 'ADDED-B' }, arrivalTime: T0 / 1000 + 40 }),
      ];
      reconcileAddedTrips(deps, entries);

      // Only one match; the second becomes a new row
      expect(deps).toHaveLength(2);
      expect(deps[0].realtimeDelaySeconds).toBe(20); // first ADDED wins (sorted ascending)
    });
  });

  describe('high-frequency route (ascending sort correctness)', () => {
    it('assigns each ADDED trip to its nearest earlier slot on 2-min headways', () => {
      // Scheduled: 13:00, 13:02, 13:04
      const deps = [
        sched({ tripId: 'trip-A', realtimeArrival: new Date(T0).toISOString() }),
        sched({ tripId: 'trip-B', realtimeArrival: new Date(T0 + 2 * 60000).toISOString() }),
        sched({ tripId: 'trip-C', realtimeArrival: new Date(T0 + 4 * 60000).toISOString() }),
      ];
      // ADDED (passed in reversed order to verify sort):
      //   ADDED-X ≈ 13:04:15 → should match trip-C
      //   ADDED-Y ≈ 13:02:20 → should match trip-B
      const entries = [
        added({
          trip: { ...added().trip, tripId: 'ADDED-X' },
          arrivalTime: T0 / 1000 + 4 * 60 + 15,
        }),
        added({
          trip: { ...added().trip, tripId: 'ADDED-Y' },
          arrivalTime: T0 / 1000 + 2 * 60 + 20,
        }),
      ];
      reconcileAddedTrips(deps, entries);

      expect(deps).toHaveLength(3); // no appended rows
      expect(deps[0].hasRealtime).toBe(false); // trip-A untouched
      expect(deps[1].realtimeDelaySeconds).toBe(20); // trip-B ← ADDED-Y
      expect(deps[2].realtimeDelaySeconds).toBe(15); // trip-C ← ADDED-X
    });
  });

  describe('headsign fallback', () => {
    it('applies headsignFallback when scheduled trip has no headsign', () => {
      const deps = [sched({ headsign: null })];
      const entries = [added({ headsignFallback: 'Alewife' })];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].headsign).toBe('Alewife');
    });

    it('prefers trip.headsign over headsignFallback', () => {
      const deps = [sched({ headsign: null })];
      const entries = [
        added({ trip: { ...added().trip, headsign: 'Braintree' }, headsignFallback: 'Alewife' }),
      ];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].headsign).toBe('Braintree');
    });

    it('does not overwrite existing headsign on scheduled trip', () => {
      const deps = [sched({ headsign: 'Alewife' })];
      const entries = [
        added({ trip: { ...added().trip, headsign: 'Braintree' }, headsignFallback: 'Somewhere' }),
      ];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].headsign).toBe('Alewife');
    });

    it('uses headsignFallback on appended new-service rows', () => {
      const deps: ArrivalResponse[] = [];
      const entries = [added({ headsignFallback: 'Alewife' })];
      reconcileAddedTrips(deps, entries);

      expect(deps[0].headsign).toBe('Alewife');
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
      const deps: ArrivalResponse[] = [];
      reconcileAddedTrips(deps, [
        added(),
        added({ trip: { ...added().trip, tripId: 'ADDED-002' }, arrivalTime: T0 / 1000 + 120 }),
      ]);
      expect(deps).toHaveLength(2);
      expect(deps.every((d) => d.hasRealtime)).toBe(true);
    });

    it('does not mutate the original addedEntries array order', () => {
      const deps = [sched()];
      const entries = [
        added({ trip: { ...added().trip, tripId: 'ADDED-Z' }, arrivalTime: T0 / 1000 + 200 }),
        added({ trip: { ...added().trip, tripId: 'ADDED-A' }, arrivalTime: T0 / 1000 + 10 }),
      ];
      const originalOrder = entries.map((e) => e.trip.tripId);
      reconcileAddedTrips(deps, entries);
      expect(entries.map((e) => e.trip.tripId)).toEqual(originalOrder);
    });
  });
});
