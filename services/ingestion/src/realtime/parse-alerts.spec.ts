/// <reference types="jest" />
import { isAlertActive, isRouteWideAlert, isUrgentAlert } from '@transit-tracker/shared';
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

  it('reads severity level, defaulting to UNKNOWN_SEVERITY', () => {
    expect(detour.severityLevel).toBe('SEVERE');
    expect(spanishOnly.severityLevel).toBe('UNKNOWN_SEVERITY');
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

describe('isUrgentAlert()', () => {
  it.each([
    ['NO_SERVICE', 'WARNING', true],
    ['SIGNIFICANT_DELAYS', 'WARNING', true],
    ['DETOUR', 'INFO', true],
    ['STOP_MOVED', 'INFO', true],
    // MBTA files bus delays as OTHER_EFFECT + SEVERE.
    ['OTHER_EFFECT', 'SEVERE', true],
    ['OTHER_EFFECT', 'WARNING', false],
    ['ACCESSIBILITY_ISSUE', 'WARNING', false],
    ['UNKNOWN_EFFECT', undefined, false],
  ])('%s / %s -> %s', (effect, severityLevel, urgent) => {
    expect(isUrgentAlert({ effect, severityLevel })).toBe(urgent);
  });

  it.each([
    // MBTA files delays and suspensions under generic effects; effect_detail says what they are.
    ['OTHER_EFFECT', 'DELAY', true],
    ['REDUCED_SERVICE', 'SUSPENSION', true],
    ['DETOUR', 'SHUTTLE', true],
    ['OTHER_EFFECT', 'TRACK_CHANGE', true],
    ['ACCESSIBILITY_ISSUE', 'ELEVATOR_CLOSURE', false],
    ['OTHER_EFFECT', 'PARKING_ISSUE', false],
    ['OTHER_EFFECT', 'NOTICE', false],
    ['UNKNOWN_EFFECT', 'SERVICE_CHANGE', false],
  ])('%s + effect_detail %s -> %s', (effect, effectDetail, urgent) => {
    expect(isUrgentAlert({ effect, effectDetail, severityLevel: 'WARNING' })).toBe(urgent);
  });
});

describe('isRouteWideAlert()', () => {
  const entity = (routeId: string | null, stopId: string | null, tripId: string | null = null) => ({
    routeId,
    routeType: null,
    stopId,
    tripId,
  });
  const red = new Set(['Red']);

  it('matches an alert on the whole route', () => {
    expect(isRouteWideAlert({ informedEntities: [entity('Red', null)] }, red)).toBe(true);
  });

  it('does not match an alert on one stop or trip of the route, or another route', () => {
    expect(isRouteWideAlert({ informedEntities: [entity('Red', '70061')] }, red)).toBe(false);
    expect(isRouteWideAlert({ informedEntities: [entity('Red', null, 'T1')] }, red)).toBe(false);
    expect(isRouteWideAlert({ informedEntities: [entity('Orange', null)] }, red)).toBe(false);
    expect(isRouteWideAlert({ informedEntities: [entity('Red', null)] }, new Set())).toBe(false);
  });
});
