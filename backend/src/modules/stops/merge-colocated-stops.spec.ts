/// <reference types="jest" />
import { mergeColocatedStops, STOP_MERGE_RADIUS_DEG } from './mergeColocatedStops';
import type { StopResponse, StopRouteRef } from './stops.types';

// ─── helpers ────────────────────────────────────────────────────────────────

const route = (routeId: string, shortName = routeId): StopRouteRef => ({
  routeId,
  shortName,
  longName: `${routeId} Line`,
  routeType: 3,
});

/** Base coordinates — downtown Boston */
const BASE_LAT = 42.358;
const BASE_LON = -71.06;

/** Offset in degrees that stays well within the 150m merge radius. */
const NEAR = STOP_MERGE_RADIUS_DEG * 0.3;

/** Offset in degrees that exceeds the 150m merge radius. */
const FAR = STOP_MERGE_RADIUS_DEG * 2;

function stop(
  stopId: string,
  name: string,
  routes: StopRouteRef[],
  latOffset = 0,
  lonOffset = 0,
): StopResponse {
  return {
    id: stopId,
    stopId,
    stopName: name,
    stopCode: null,
    lat: BASE_LAT + latOffset,
    lon: BASE_LON + lonOffset,
    wheelchairBoarding: null,
    routes,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('mergeColocatedStops', () => {
  it('returns a single stop unchanged', () => {
    const input = [stop('A', 'Main St', [route('15')])];
    expect(mergeColocatedStops(input)).toEqual(input);
  });

  it('merges two stops with same name, near location, and shared route', () => {
    const input = [
      stop('A', 'Somerset St', [route('713')], 0, 0),
      stop('B', 'Somerset St', [route('713'), route('15')], NEAR, NEAR),
    ];
    const result = mergeColocatedStops(input);
    expect(result).toHaveLength(1);
    expect(result[0].stopId).toBe('A');
    expect(result[0].routes!.map((r) => r.routeId).sort()).toEqual(['15', '713']);
  });

  it('does NOT merge stops with different names', () => {
    const input = [
      stop('A', 'Washington St', [route('15')], 0, 0),
      stop('B', 'Tremont St', [route('15')], NEAR, NEAR),
    ];
    expect(mergeColocatedStops(input)).toHaveLength(2);
  });

  it('does NOT merge stops that are too far apart', () => {
    const input = [
      stop('A', 'Main St', [route('15')], 0, 0),
      stop('B', 'Main St', [route('15')], FAR, FAR),
    ];
    expect(mergeColocatedStops(input)).toHaveLength(2);
  });

  it('does NOT merge nearby stops with the same name but no shared route', () => {
    const input = [
      stop('A', 'Washington St @ Tufts', [route('SL4'), route('SL5')], 0, 0),
      stop('B', 'Washington St @ Tufts', [route('39')], NEAR, NEAR),
    ];
    expect(mergeColocatedStops(input)).toHaveLength(2);
  });

  it('deduplicates routes in merged result', () => {
    const input = [
      stop('A', 'Somerset St', [route('713'), route('15')], 0, 0),
      stop('B', 'Somerset St', [route('713'), route('11')], NEAR, NEAR),
    ];
    const result = mergeColocatedStops(input);
    expect(result).toHaveLength(1);
    // route 713 must appear exactly once
    const ids = result[0].routes!.map((r) => r.routeId);
    expect(ids.filter((id) => id === '713')).toHaveLength(1);
    expect(ids.sort()).toEqual(['11', '15', '713']);
  });

  it('sorts merged routes by shortName', () => {
    const input = [
      stop('A', 'Main St', [route('39', '39')], 0, 0),
      stop('B', 'Main St', [route('11', '11'), route('39', '39')], NEAR, NEAR),
    ];
    const result = mergeColocatedStops(input);
    expect(result[0].routes!.map((r) => r.shortName)).toEqual(['11', '39']);
  });

  it('handles three nearby stops — merges all when they form a connected chain', () => {
    // A shares route with B; B shares route with C (but A and C may not share)
    // Only A+B should merge together; C should remain separate (no shared route with A)
    const input = [
      stop('A', 'Main St', [route('15')], 0, 0),
      stop('B', 'Main St', [route('15'), route('39')], NEAR, NEAR),
      stop('C', 'Main St', [route('39')], NEAR * 2, NEAR * 2),
    ];
    // B shares route 15 with A → merged into A's group
    // C shares route 39 with B, but B is already consumed, C standalone
    const result = mergeColocatedStops(input);
    expect(result).toHaveLength(2);
    expect(result[0].routes!.map((r) => r.routeId).sort()).toEqual(['15', '39']);
    expect(result[1].routes!.map((r) => r.routeId)).toEqual(['39']);
  });

  it('returns empty array for empty input', () => {
    expect(mergeColocatedStops([])).toEqual([]);
  });

  it('handles stops with undefined routes gracefully', () => {
    const input = [
      {
        ...stop('A', 'Main St', [route('15')], 0, 0),
        routes: undefined as unknown as StopRouteRef[],
      },
      stop('B', 'Main St', [route('15')], NEAR, NEAR),
    ];
    expect(() => mergeColocatedStops(input)).not.toThrow();
  });
});
