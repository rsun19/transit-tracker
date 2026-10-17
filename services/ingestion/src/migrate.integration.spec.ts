/// <reference types="jest" />
// Runs the schema migrations against PostGIS. Skipped unless TEST_DATABASE_URL
// points at a scratch database (it is wiped); see gtfs-static.integration.spec.ts.
import 'reflect-metadata';
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

  it('adopt an existing production database without touching its schema', async () => {
    // Production before migrations: the baseline schema built by synchronize
    // and ad-hoc DDL, no migrations table, no data_version yet, and the
    // trigram indexes missing (synchronize had just dropped them).
    await resetSchema();
    const { ds: seed } = await migrate();
    await seed.query(`INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url)
                      VALUES ('mbta', 'MBTA', 'America/New_York', 'https://example.com/gtfs.zip')`);
    await seed.query(`DROP TABLE migrations`);
    await seed.query(`DROP INDEX idx_stops_location_geography, idx_stops_agency_parent_station,
                      idx_stops_stop_name_trgm, idx_stops_stop_code_trgm`);
    await seed.query(`ALTER TABLE agencies DROP COLUMN data_version`);
    await seed.destroy();

    const { ds, ran } = await migrate();
    try {
      expect(ran).toEqual(allNames);
      expect(await entityDrift(ds)).toEqual([]);
      expect(await indexNames(ds)).toEqual(
        expect.arrayContaining([
          'idx_stops_location_geography',
          'idx_stops_agency_parent_station',
          'idx_stops_stop_name_trgm',
          'idx_stops_stop_code_trgm',
        ]),
      );
      const [agency] = await ds.query(`SELECT agency_key, data_version FROM agencies`);
      expect(agency).toEqual({ agency_key: 'mbta', data_version: 0 });
    } finally {
      await ds.destroy();
    }
  });
});
