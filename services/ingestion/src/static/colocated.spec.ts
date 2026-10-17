/// <reference types="jest" />
import { colocatedGroups, type StopPoint } from './colocated';

const stop = (stopId: string, stopName: string, lat: number, lon: number): StopPoint => ({
  stopId,
  stopName,
  lat,
  lon,
});
const routes = (m: Record<string, string[]>) =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));

describe('colocatedGroups()', () => {
  it('groups same-name stops across the street that share a route', () => {
    const groups = colocatedGroups(
      [stop('A', 'Main St', 42.35, -71.06), stop('B', 'Main St', 42.3501, -71.0601)],
      routes({ A: ['1'], B: ['1', '2'] }),
    );
    expect(groups).toEqual(
      new Map([
        ['A', 'A'],
        ['B', 'A'],
      ]),
    );
  });

  it('leaves apart stops that are far apart, differently named, or share no route', () => {
    const groups = colocatedGroups(
      [
        stop('A', 'Main St', 42.35, -71.06),
        stop('FAR', 'Main St', 42.36, -71.06),
        stop('NAME', 'Elm St', 42.35, -71.06),
        stop('ROUTE', 'Main St', 42.35, -71.06),
      ],
      routes({ A: ['1'], FAR: ['1'], NAME: ['1'], ROUTE: ['9'] }),
    );
    expect(groups.size).toBe(0);
  });
});
