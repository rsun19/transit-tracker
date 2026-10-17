/// <reference types="jest" />
import { checkRequiredFiles, checkRowCounts } from './gtfs-static.service';

const ALL = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'];

describe('checkRequiredFiles()', () => {
  it('accepts a feed with the core files and either calendar file', () => {
    expect(() => checkRequiredFiles(new Set([...ALL, 'calendar.txt']))).not.toThrow();
    expect(() => checkRequiredFiles(new Set([...ALL, 'calendar_dates.txt']))).not.toThrow();
  });

  it('names what is missing', () => {
    expect(() =>
      checkRequiredFiles(new Set(['agency.txt', 'stops.txt', 'routes.txt', 'stop_times.txt'])),
    ).toThrow('GTFS feed is missing trips.txt, calendar.txt or calendar_dates.txt');
  });
});

describe('checkRowCounts()', () => {
  const live = { routes: 100, stops: 1000, trips: 10_000, stop_times: 100_000 };
  const ok = { ...live, service_calendars: 5, service_calendar_dates: 0 };

  it('accepts a normal reload', () => {
    expect(() => checkRowCounts(ok, live)).not.toThrow();
    expect(() => checkRowCounts({ ...ok, stop_times: 50_000 }, live)).not.toThrow();
  });

  it('accepts the first load, when nothing is live yet', () => {
    expect(() => checkRowCounts(ok, {})).not.toThrow();
  });

  it('refuses a core table under half of the current data', () => {
    expect(() => checkRowCounts({ ...ok, stop_times: 49_999 }, live)).toThrow(
      'stop_times dropped from 100000 to 49999 rows',
    );
  });

  it('refuses empty core tables and a feed with no calendar', () => {
    expect(() => checkRowCounts({ ...ok, trips: 0, service_calendars: 0 }, live)).toThrow(
      'trips is empty; no service calendar rows',
    );
  });
});
