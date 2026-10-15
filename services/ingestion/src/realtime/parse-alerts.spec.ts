/// <reference types="jest" />
import { isAlertActive } from '@transit-tracker/shared';
import { parseAlerts, type StopHierarchy } from './parse-alerts';
import { FEED_TIMESTAMP as T, alertsFeed } from './__fixtures__/feeds';

const stops: StopHierarchy = {
  parentOf: new Map([
    ['70061', 'place-alfcl'],
    ['Alewife-01', 'place-alfcl'],
    ['70063', 'place-davis'],
  ]),
  childrenOf: new Map([
    ['place-alfcl', ['70061', 'Alewife-01']],
    ['place-davis', ['70063', '70064']],
  ]),
};

describe('parseAlerts()', () => {
  const [detour, spanishOnly] = parseAlerts(alertsFeed(), stops);

  it('picks the English translation, not the first one', () => {
    expect(detour.headerText).toBe('Detour at Alewife');
  });

  it('accepts a translation with no language as English', () => {
    expect(detour.descriptionText).toBe('Shuttle buses replace service');
  });

  it('returns empty text when there is no English translation', () => {
    expect(spanishOnly.headerText).toBe('');
  });

  it('accepts a regional English tag like en-US', () => {
    expect(spanishOnly.descriptionText).toBe('US English only');
  });

  it('maps effect and cause to their enum names', () => {
    expect(detour.effect).toBe('DETOUR');
    expect(detour.cause).toBe('CONSTRUCTION');
    expect(spanishOnly.effect).toBe('UNKNOWN_EFFECT');
  });

  it('reads active periods, with open-ended ends as null', () => {
    expect(detour.activePeriods).toEqual([
      { start: T - 3600, end: T + 3600 },
      { start: T + 86_400, end: null },
    ]);
  });

  it('widens a parent-station stop to its child platforms', () => {
    expect(detour.stopIds.sort()).toEqual(['70061', 'Alewife-01', 'place-alfcl']);
  });

  it('widens a child-platform stop to its parent station, but not its siblings', () => {
    expect(spanishOnly.stopIds.sort()).toEqual(['70063', 'place-davis']);
  });

  it('keeps exact stop ids when no hierarchy is loaded', () => {
    const [alert] = parseAlerts(alertsFeed(), null);
    expect(alert.stopIds).toEqual(['place-alfcl']);
  });

  it('collects route and trip ids, including the trip descriptor route', () => {
    expect(spanishOnly.routeIds).toEqual(['Red']);
    expect(spanishOnly.tripIds).toEqual(['T-SCHED']);
    expect(spanishOnly.informedEntities).toEqual([
      { routeId: null, routeType: null, stopId: '70063', tripId: null },
      { routeId: 'Red', routeType: null, stopId: null, tripId: 'T-SCHED' },
    ]);
  });
});

describe('isAlertActive()', () => {
  const [detour, alwaysOn] = parseAlerts(alertsFeed(), null);

  it('is active inside a period', () => {
    expect(isAlertActive(detour, T)).toBe(true);
  });

  it('is inactive between periods', () => {
    expect(isAlertActive(detour, T + 7200)).toBe(false);
  });

  it('is active in an open-ended period', () => {
    expect(isAlertActive(detour, T + 10 * 86_400)).toBe(true);
  });

  it('is always active with no periods', () => {
    expect(isAlertActive(alwaysOn, 0)).toBe(true);
  });
});
