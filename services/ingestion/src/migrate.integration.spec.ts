/// <reference types="jest" />
// Runs the schema migrations against PostGIS. Skipped unless TEST_DATABASE_URL
// points at a scratch database (it is wiped); see gtfs-static.integration.spec.ts.
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from '@transit-tracker/shared';
import { migrationDataSource } from './migrate';

const DB_URL = process.env['TEST_DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

async function resetSchema(): Promise<void> {
  const admin = new DataSource({ type: 'postgres', url: DB_URL });
  await admin.initialize();
  await admin.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
  await admin.destroy();
}

async function migrate(): Promise<{ ds: DataSource; ran: string[] }> {
  const ds = migrationDataSource(DB_URL!);
  await ds.initialize();
  const ran = (await ds.runMigrations()).map((m) => m.name);
  return { ds, ran };
}

/** SQL TypeORM would run to make the database match the entities. */
async function entityDrift(ds: DataSource): Promise<string[]> {
  const log = await ds.driver.createSchemaBuilder().log();
  return log.upQueries.map((q) => q.query);
}

async function indexNames(ds: DataSource): Promise<string[]> {
  const rows: Array<{ indexname: string }> = await ds.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`,
  );
  return rows.map((r) => r.indexname);
}

/**
 * Every column, constraint and index in public (except the migrations
 * table), in a stable order, so two databases can be compared exactly.
 */
async function schemaSignature(ds: DataSource): Promise<string[]> {
  const columns: Array<{ s: string }> = await ds.query(
    `SELECT concat_ws(' ', 'column', table_name, ordinal_position, column_name, data_type,
                      character_maximum_length, is_nullable, column_default) AS s
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name <> 'migrations'
       AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
     ORDER BY table_name, ordinal_position`,
  );
  const constraints: Array<{ s: string }> = await ds.query(
    `SELECT concat_ws(' ', 'constraint', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)) AS s
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public' AND c.conrelid::regclass::text <> 'migrations'
       AND c.contype IN ('p', 'u', 'f', 'c')
     ORDER BY 1`,
  );
  const indexes: Array<{ s: string }> = await ds.query(
    `SELECT concat_ws(' ', 'index', indexdef) AS s FROM pg_indexes
     WHERE schemaname = 'public' AND tablename <> 'migrations' ORDER BY 1`,
  );
  return [...columns, ...constraints, ...indexes].map((r) => r.s);
}

const PROD_SCHEMA = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'prod-schema-2026-10-17.sql'),
  'utf8',
);

describeDb('schema migrations against PostGIS', () => {
  const allNames = MIGRATIONS.map((M) => new M().name!);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('build a fresh database that matches the entities', async () => {
    await resetSchema();
    const { ds, ran } = await migrate();
    try {
      expect(ran).toEqual(allNames);
      expect(await entityDrift(ds)).toEqual([]);
      expect(await indexNames(ds)).toEqual(
        expect.arrayContaining([
          'idx_stops_location_geography',
          'idx_stops_agency_parent_station',
          'idx_stops_stop_name_trgm',
          'idx_route_stops_agency_stop',
        ]),
      );
    } finally {
      await ds.destroy();
    }
  });

  it('do nothing on a second run', async () => {
    const { ds, ran } = await migrate();
    await ds.destroy();
    expect(ran).toEqual([]);
  });

  it('adopt the production schema and end up identical to a fresh install', async () => {
    // A fresh install, for reference.
    await resetSchema();
    const { ds: fresh } = await migrate();
    const expected = await schemaSignature(fresh);
    await fresh.destroy();

    // Production as it was before migrations: its real schema (pg_dump),
    // a row of data, no migrations table, no data_version yet.
    await resetSchema();
    const admin = new DataSource({ type: 'postgres', url: DB_URL });
    await admin.initialize();
    for (const ext of ['postgis', 'pg_trgm', '"uuid-ossp"']) {
      await admin.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    await admin.query(PROD_SCHEMA);
    await admin.query(`INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url)
                       VALUES ('mbta', 'MBTA', 'America/New_York', 'https://example.com/gtfs.zip')`);
    await admin.destroy();

    const { ds, ran } = await migrate();
    try {
      expect(ran).toEqual(allNames);
      // Same columns (route_stops and route_branches included), constraints
      // and indexes as a fresh install, and no drift from the entities.
      expect(await schemaSignature(ds)).toEqual(expected);
      expect(await entityDrift(ds)).toEqual([]);
      const [agency] = await ds.query(`SELECT agency_key, data_version FROM agencies`);
      expect(agency).toEqual({ agency_key: 'mbta', data_version: 0 });
    } finally {
      await ds.destroy();
    }
  });
});
