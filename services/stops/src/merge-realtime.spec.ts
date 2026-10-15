/// <reference types="jest" />
import type { StopRealtime, TripRealtime } from '@transit-tracker/shared';
import {
  addedTripStopAt,
  mergeRealtime,
  parseTripRealtime,
  selectUpcoming,
  statusForDelay,
  stopIdsNeedingParent,
  toArrivalResponse,
  type ScheduledRow,
} from './merge-realtime';

const NOW = 1_792_000_000;
const iso = (s: number) => new Date(s * 1000).toISOString();

function row(overrides: Partial<ScheduledRow> = {}): ScheduledRow {
  return {
    tripId: 'T1',
    routeId: 'Red',
    routeShortName: null,
    routeLongName: 'Red Line',
    routeType: 1,
    headsign: 'Ashmont',
    directionId: 0,
    stopId: '70061',
    parentStationId: 'place-alfcl',
    stopSequence: 1,
    serviceDate: '20261014',
    scheduledArrival: NOW + 600,
    scheduledDeparture: NOW + 600,
    pickupType: 0,
    ...overrides,
  };
}

function stop(overrides: Partial<StopRealtime> = {}): StopRealtime {
  return {
    stopSequence: 1,
    stopId: 'Alewife-01',
    arrivalTime: null,
    departureTime: null,
    delay: null,
    skipped: false,
    uncertainty: null,
    ...overrides,
  };
}

function trip(stops: StopRealtime[], overrides: Partial<TripRealtime> = {}): TripRealtime {
  return {
    tripId: 'T1',
    routeId: 'Red',
    directionId: 0,
    startDate: '20261014',
    canceled: false,
    stops,
    feedTimestamp: NOW,
    ...overrides,
  };
}

const realtime = (...trips: TripRealtime[]) => new Map(trips.map((t) => [t.tripId, t]));

describe('mergeRealtime()', () => {
  it('matches by stop_sequence when the realtime stop_id is a child platform', () => {
    const [a] = mergeRealtime(
      [row()],
      realtime(trip([stop({ stopId: 'Alewife-01', departureTime: NOW + 700 })])),
    );
    expect(a).toMatchObject({ hasRealtime: true, predictedTime: iso(NOW + 700) });
  });

  it('uses the departure-only prediction at the first stop (terminal)', () => {
    const [a] = mergeRealtime([row()], realtime(trip([stop({ departureTime: NOW + 660 })])));
    expect(a).toMatchObject({
      predictedTime: iso(NOW + 660),
      realtimeArrival: iso(NOW + 660),
      realtimeDelaySeconds: 60,
      status: 'late',
    });
  });

  it('prefers the departure prediction over the arrival one (boarding time)', () => {
    const [a] = mergeRealtime(
      [row({ scheduledArrival: NOW + 600, scheduledDeparture: NOW + 630 })],
      realtime(trip([stop({ arrivalTime: NOW + 610, departureTime: NOW + 640 })])),
    );
    expect(a.predictedTime).toBe(iso(NOW + 640));
    expect(a.scheduledTime).toBe(iso(NOW + 630));
    expect(a.realtimeDelaySeconds).toBe(10);
  });

  it('compares an arrival-only prediction against the scheduled arrival', () => {
    const [a] = mergeRealtime(
      [row({ scheduledArrival: NOW + 600, scheduledDeparture: NOW + 660 })],
      realtime(trip([stop({ arrivalTime: NOW + 600 })])),
    );
    expect(a.realtimeDelaySeconds).toBe(0);
    expect(a.status).toBe('on_time');
  });

  it('computes delay as predicted - scheduled, ignoring the absent feed delay', () => {
    const [a] = mergeRealtime([row()], realtime(trip([stop({ departureTime: NOW + 600 - 180 })])));
    expect(a.realtimeDelaySeconds).toBe(-180);
    expect(a.status).toBe('early');
  });

  it('falls back to schedule + delay when the feed sends only a delay', () => {
    const [a] = mergeRealtime([row()], realtime(trip([stop({ delay: 120 })])));
    expect(a.predictedTime).toBe(iso(NOW + 720));
    expect(a.realtimeDelaySeconds).toBe(120);
  });

  it('marks skipped stops', () => {
    const [a] = mergeRealtime([row()], realtime(trip([stop({ skipped: true })])));
    expect(a.status).toBe('skipped');
    expect(a.hasRealtime).toBe(false);
  });

  it('marks canceled trips', () => {
    const [a] = mergeRealtime([row()], realtime(trip([], { canceled: true })));
    expect(a.status).toBe('canceled');
  });

  it('ignores realtime for a different service day of the same trip_id', () => {
    const [a] = mergeRealtime(
      [row({ serviceDate: '20261013' })],
      realtime(trip([stop({ departureTime: NOW + 700 })])),
    );
    expect(a.hasRealtime).toBe(false);
  });

  it('applies realtime with no start date to any service day', () => {
    const [a] = mergeRealtime(
      [row({ serviceDate: '20261013' })],
      realtime(trip([stop({ departureTime: NOW + 700 })], { startDate: null })),
    );
    expect(a.hasRealtime).toBe(true);
  });

  it('without a prediction: status scheduled, hasRealtime false, scheduled time shown', () => {
    const [a] = mergeRealtime([row()], new Map());
    expect(a).toMatchObject({
      status: 'scheduled',
      hasRealtime: false,
      realtimeDelaySeconds: null,
      predictedTime: null,
      realtimeArrival: iso(NOW + 600),
      scheduledTime: iso(NOW + 600),
    });
  });

  it('does not match a sequenced realtime stop by stop_id (loop routes)', () => {
    const [a] = mergeRealtime(
      [row({ stopSequence: 1, stopId: '70061' })],
      realtime(trip([stop({ stopSequence: 9, stopId: '70061', departureTime: NOW + 900 })])),
    );
    expect(a.hasRealtime).toBe(false);
  });

  it('matches an unsequenced realtime stop by stop_id, then by parent station', () => {
    const byId = mergeRealtime(
      [row()],
      realtime(trip([stop({ stopSequence: null, stopId: '70061', departureTime: NOW + 700 })])),
    );
    expect(byId[0].hasRealtime).toBe(true);

    const rt = realtime(
      trip([stop({ stopSequence: null, stopId: 'Alewife-01', departureTime: NOW + 700 })]),
    );
    expect(mergeRealtime([row()], rt)[0].hasRealtime).toBe(false);
    const byParent = mergeRealtime([row()], rt, new Map([['Alewife-01', 'place-alfcl']]));
    expect(byParent[0].hasRealtime).toBe(true);
  });

  it('flags a stop the vehicle has already passed', () => {
    const [a] = mergeRealtime(
      [row({ stopSequence: 2 })],
      realtime(trip([stop({ stopSequence: 5, departureTime: NOW + 900 })])),
    );
    expect(a.passed).toBe(true);
  });

  it('reads uncertainty', () => {
    const [a] = mergeRealtime(
      [row()],
      realtime(trip([stop({ departureTime: NOW + 600, uncertainty: 60 })])),
    );
    expect(a.uncertaintySeconds).toBe(60);
  });
});

describe('selectUpcoming()', () => {
  const cutoff = NOW - 30;

  it('keeps a late trip scheduled 20 min ago and predicted in 5 min', () => {
    const merged = mergeRealtime(
      [row({ scheduledArrival: NOW - 1200, scheduledDeparture: NOW - 1200 })],
      realtime(trip([stop({ departureTime: NOW + 300 })])),
    );
    const [a] = selectUpcoming(merged, cutoff, 10);
    expect(a.realtimeDelaySeconds).toBe(1500);
    expect(a.status).toBe('late');
  });

  it('drops a prediction that is in the past', () => {
    const merged = mergeRealtime([row()], realtime(trip([stop({ departureTime: NOW - 60 })])));
    expect(selectUpcoming(merged, cutoff, 10)).toEqual([]);
  });

  it('drops a scheduled-only row from the late window', () => {
    const merged = mergeRealtime(
      [row({ scheduledArrival: NOW - 1200, scheduledDeparture: NOW - 1200 })],
      new Map(),
    );
    expect(selectUpcoming(merged, cutoff, 10)).toEqual([]);
  });

  it('hides canceled trips, skipped stops, passed stops and no-pickup rows', () => {
    const merged = mergeRealtime(
      [
        row({ tripId: 'canceled' }),
        row({ tripId: 'skipped' }),
        row({ tripId: 'passed', stopSequence: 1 }),
        row({ tripId: 'no-pickup', pickupType: 1 }),
        row({ tripId: 'ok' }),
      ],
      realtime(
        trip([], { tripId: 'canceled', canceled: true }),
        trip([stop({ skipped: true })], { tripId: 'skipped' }),
        trip([stop({ stopSequence: 3, departureTime: NOW + 900 })], { tripId: 'passed' }),
      ),
    );
    expect(selectUpcoming(merged, cutoff, 10).map((a) => a.tripId)).toEqual(['ok']);
  });

  it('sorts by effective time (not time + delay) and applies the limit after merging', () => {
    const merged = mergeRealtime(
      [
        row({ tripId: 'early-sched-late-pred', scheduledDeparture: NOW + 100 }),
        row({ tripId: 'later-sched', scheduledDeparture: NOW + 400 }),
        row({ tripId: 'latest-sched', scheduledDeparture: NOW + 800 }),
      ],
      realtime(trip([stop({ departureTime: NOW + 600 })], { tripId: 'early-sched-late-pred' })),
    );
    expect(selectUpcoming(merged, cutoff, 2).map((a) => a.tripId)).toEqual([
      'later-sched',
      'early-sched-late-pred',
    ]);
  });
});

describe('toArrivalResponse()', () => {
  it('strips the internal fields', () => {
    const [a] = mergeRealtime([row()], new Map());
    expect(Object.keys(toArrivalResponse(a)).sort()).toEqual(
      [
        'tripId',
        'routeId',
        'routeShortName',
        'routeLongName',
        'headsign',
        'directionId',
        'realtimeArrival',
        'realtimeDelaySeconds',
        'hasRealtime',
        'scheduledTime',
        'predictedTime',
        'status',
        'uncertaintySeconds',
      ].sort(),
    );
  });
});

describe('statusForDelay()', () => {
  it.each([
    [0, 'on_time'],
    [59, 'on_time'],
    [-59, 'on_time'],
    [60, 'late'],
    [-60, 'early'],
  ])('%i s → %s', (delay, status) => {
    expect(statusForDelay(delay)).toBe(status);
  });
});

describe('parseTripRealtime()', () => {
  it('parses a v2 value', () => {
    expect(parseTripRealtime(JSON.stringify(trip([stop()])))?.tripId).toBe('T1');
  });

  it.each([null, '', 'not json', '42', '{"70061":{"delay":0}}'])(
    'rejects %p (missing, malformed, or legacy format)',
    (raw) => {
      expect(parseTripRealtime(raw)).toBeNull();
    },
  );
});

describe('stopIdsNeedingParent()', () => {
  it('returns only stop ids without a stop_sequence', () => {
    const ids = stopIdsNeedingParent([
      trip([stop({ stopSequence: 1, stopId: 'A' }), stop({ stopSequence: null, stopId: 'B' })]),
    ]);
    expect(ids).toEqual(['B']);
  });
});

describe('addedTripStopAt()', () => {
  const stopIds = new Set(['70061']);
  const stationIds = new Set(['place-alfcl']);
  const parentOf = new Map([['Alewife-02', 'place-alfcl']]);

  it('finds the stop through its parent station', () => {
    const t = trip([
      stop({ stopId: 'Alewife-02', departureTime: NOW + 120, uncertainty: 30 }),
      stop({ stopSequence: 2, stopId: '70063', arrivalTime: NOW + 300 }),
    ]);
    expect(addedTripStopAt(t, stopIds, stationIds, parentOf, NOW)).toEqual({
      predictedTime: NOW + 120,
      uncertainty: 30,
    });
  });

  it('skips skipped stops and predictions before the cutoff', () => {
    const t = trip([
      stop({ stopId: '70061', departureTime: NOW + 120, skipped: true }),
      stop({ stopId: '70061', departureTime: NOW - 120 }),
    ]);
    expect(addedTripStopAt(t, stopIds, stationIds, parentOf, NOW)).toBeNull();
  });

  it('returns null when the trip does not serve the stop', () => {
    const t = trip([stop({ stopId: '70063', departureTime: NOW + 120 })]);
    expect(addedTripStopAt(t, stopIds, stationIds, parentOf, NOW)).toBeNull();
  });
});
