/// <reference types="jest" />
// Runs the real loader against PostGIS. Skipped unless TEST_DATABASE_URL
// points at a scratch database (it is wiped), e.g.
//   docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=pw postgis/postgis:16-3.4-alpine
//   TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/postgres npx jest gtfs-static.integration
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import {
  Agency,
  Route,
  ServiceCalendar,
  ServiceCalendarDate,
  Shape,
  Stop,
  StopTime,
  Trip,
  type ResolvedAgency,
} from '@transit-tracker/shared';
import { GtfsStaticService } from './gtfs-static.service';
import { FEED, feedEntries } from './static/__fixtures__/gtfs';
import { makeZip } from './static/__fixtures__/zip';

const DB_URL = process.env['TEST_DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

describeDb('GtfsStaticService against PostGIS', () => {
  let dataSource: DataSource;
  let server: http.Server;
  let zip: Buffer;
  let agency: ResolvedAgency;
  let service: GtfsStaticService;

  const serve = (overrides: Record<string, string | null> = {}) => {
    zip = makeZip(feedEntries(overrides));
  };
  const count = async (table: string): Promise<number> => {
    const [row] = await dataSource.query(`SELECT count(*)::int AS n FROM ${table}`);
    return row.n;
  };
  const snapshot = async () => {
    const tables = [
      'routes',
      'trips',
      'stops',
      'stop_times',
      'shapes',
      'service_calendars',
      'service_calendar_dates',
      'route_stops',
      'route_branches',
    ];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = await count(t);
    return out;
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const admin = new DataSource({ type: 'postgres', url: DB_URL });
    await admin.initialize();
    await admin.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
    for (const ext of ['postgis', 'pg_trgm', 'pgcrypto', '"uuid-ossp"']) {
      await admin.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    await admin.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url: DB_URL,
      synchronize: true,
      entities: [Agency, Route, Stop, StopTime, Trip, Shape, ServiceCalendar, ServiceCalendarDate],
    });
    await dataSource.initialize();

    server = http.createServer((_req, res) => res.end(zip));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    agency = {
      key: 'test',
      displayName: 'Test',
      timezone: 'America/New_York',
      gtfsStaticUrl: `http://127.0.0.1:${port}/gtfs.zip`,
    } as ResolvedAgency;
    service = new GtfsStaticService(dataSource);
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await dataSource?.destroy();
    jest.restoreAllMocks();
  });

  it('loads the feed once, with valid rows only and derived tables built', async () => {
    serve();
    await service.ingestAgency(agency);

    expect(await snapshot()).toEqual({
      routes: 2,
      trips: 4,
      stops: 3, // NODE has no coordinates
      stop_times: 7, // T4's 11:99:00 is dropped
      shapes: 2, // the "bad" point is dropped
      service_calendars: 1,
      service_calendar_dates: 1,
      route_stops: 5, // R1: S1 S2 S3; R2: S2 S3
      route_branches: 3,
    });

    const [route2] = await dataSource.query(
      `SELECT color, has_stop_times FROM routes WHERE route_id = 'R2'`,
    );
    expect(route2).toEqual({ color: null, has_stop_times: true });

    const [headsign] = await dataSource.query(
      `SELECT stop_headsign FROM stop_times WHERE trip_id = 'T3' AND stop_sequence = 1`,
    );
    expect(headsign.stop_headsign).toBe('Via "Elm", then\nnorth');

    const groups = await dataSource.query(
      `SELECT stop_id, colocated_group_id FROM stops ORDER BY stop_id`,
    );
    expect(groups).toEqual([
      { stop_id: 'S1', colocated_group_id: 'S1' },
      { stop_id: 'S2', colocated_group_id: 'S1' },
      { stop_id: 'S3', colocated_group_id: null },
    ]);

    const [ag] = await dataSource.query(
      `SELECT data_version, last_ingested_at FROM agencies WHERE agency_key = 'test'`,
    );
    expect(ag.data_version).toBe(1);
    expect(ag.last_ingested_at).not.toBeNull();

    const leftovers = await dataSource.query(
      `SELECT relname FROM pg_class WHERE relname LIKE 'stage\\_%' AND relpersistence = 't'`,
    );
    expect(leftovers).toEqual([]);
  });

  it('reloading replaces the data instead of adding to it', async () => {
    const before = await snapshot();
    serve();
    await service.ingestAgency(agency);
    expect(await snapshot()).toEqual(before);
    const [ag] = await dataSource.query(
      `SELECT data_version FROM agencies WHERE agency_key = 'test'`,
    );
    expect(ag.data_version).toBe(2);
  });

  it('leaves the live data intact when a step after the COPY fails', async () => {
    const before = await snapshot();
    serve({ 'trips.txt': FEED['trips.txt'] + 'R1,WKDY,T5,Elm St,0,SH1,1\n' });
    const spy = jest
      .spyOn(
        service as unknown as { buildDerivedTables: () => Promise<void> },
        'buildDerivedTables',
      )
      .mockRejectedValueOnce(new Error('injected failure'));

    await expect(service.ingestAgency(agency)).rejects.toThrow('injected failure');
    spy.mockRestore();

    expect(await snapshot()).toEqual(before);
    expect(await count(`trips WHERE trip_id = 'T5'`)).toBe(0);
  });

  it('refuses a zip without trips.txt and keeps the old data', async () => {
    const before = await snapshot();
    serve({ 'trips.txt': null });
    await expect(service.ingestAgency(agency)).rejects.toThrow('GTFS feed is missing trips.txt');
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a feed that lost more than half its stop_times', async () => {
    const before = await snapshot();
    const lines = FEED['stop_times.txt'].trimEnd().split('\n');
    serve({ 'stop_times.txt': lines.slice(0, 3).join('\n') + '\n' });
    await expect(service.ingestAgency(agency)).rejects.toThrow(
      'stop_times dropped from 7 to 2 rows',
    );
    expect(await snapshot()).toEqual(before);
  });

  it('readers see the old data, complete, until the swap commits', async () => {
    serve({ 'trips.txt': FEED['trips.txt'] + 'R1,WKDY,T5,Elm St,0,SH1,1\n' });
    const svc = service as unknown as { swapIn: (...a: unknown[]) => Promise<void> };
    const realSwap = svc.swapIn.bind(service);
    let duringLoad: Record<string, number> | undefined;
    const spy = jest.spyOn(svc, 'swapIn').mockImplementationOnce(async (...args) => {
      // Everything is staged; the live tables must still hold one copy.
      duringLoad = await snapshot();
      return realSwap(...args);
    });
    const before = await snapshot();
    await service.ingestAgency(agency);
    spy.mockRestore();

    expect(duringLoad).toEqual(before);
    expect(await count('trips')).toBe(5);
  });

  it('skips a second load of the same agency while one is in progress', async () => {
    const before = await snapshot();
    serve({ 'trips.txt': FEED['trips.txt'] + 'R1,WKDY,T6,Main St,1,SH1,1\n' });

    // Hold the first load just before its swap, then start a second one.
    let releaseFirst!: () => void;
    const held = new Promise<void>((r) => (releaseFirst = r));
    let firstStaged!: () => void;
    const staged = new Promise<void>((r) => (firstStaged = r));
    const first = new GtfsStaticService(dataSource);
    const f = first as unknown as { swapIn: (...a: unknown[]) => Promise<void> };
    const realSwap = f.swapIn.bind(first);
    f.swapIn = async (...args) => {
      firstStaged();
      await held;
      return realSwap(...args);
    };
    const firstLoad = first.ingestAgency(agency);
    await staged;

    const second = new GtfsStaticService(dataSource);
    const swapSpy = jest.spyOn(second as unknown as { swapIn: () => Promise<void> }, 'swapIn');
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await second.ingestAgency(agency);
    expect(swapSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('another load of it is in progress'));
    expect(await snapshot()).toEqual(before);

    releaseFirst();
    await firstLoad;
    expect(await count(`trips WHERE trip_id = 'T6'`)).toBe(1);

    // The lock was released: the next load runs normally.
    serve({ 'trips.txt': FEED['trips.txt'] + 'R1,WKDY,T6,Main St,1,SH1,1\n' });
    const third = new GtfsStaticService(dataSource);
    const thirdSwap = jest.spyOn(third as unknown as { swapIn: () => Promise<void> }, 'swapIn');
    await third.ingestAgency(agency);
    expect(thirdSwap).toHaveBeenCalledTimes(1);
  });
});
