import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes the queries need, and the objects ingestion used to create on the
 * fly, which are now created only here. Everything is IF NOT EXISTS, so it
 * also brings an environment that missed one of those ad-hoc steps in line.
 */
export class IndexesAndSafetyNets1792195300000 implements MigrationInterface {
  name = 'IndexesAndSafetyNets1792195300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // New: nearby search filters and orders on location::geography; the GiST
    // index on the geometry column can't serve that.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_stops_location_geography ON stops USING gist ((location::geography))`,
    );
    // New: child platforms are looked up by parent station.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_stops_agency_parent_station ON stops (agency_id, parent_station_id)`,
    );

    // Previously created by ingestion at load time (and the trigram ones
    // dropped again by synchronize on every worker start).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    const adHoc = [
      `CREATE INDEX IF NOT EXISTS idx_stops_stop_name_trgm ON stops USING gin (stop_name gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_stops_stop_code_trgm ON stops USING gin (stop_code gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_stop_times_agency_stop_dept ON stop_times (agency_id, stop_id, departure_time)`,
      `CREATE INDEX IF NOT EXISTS idx_stop_times_agency_trip_seq ON stop_times (agency_id, trip_id, stop_sequence)`,
      `CREATE TABLE IF NOT EXISTS route_stops (
         id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
         agency_id uuid NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
         stop_id character varying(100) NOT NULL,
         route_id character varying(100) NOT NULL,
         short_name character varying(50),
         long_name text,
         route_type smallint NOT NULL,
         UNIQUE (agency_id, stop_id, route_id)
       )`,
      `CREATE INDEX IF NOT EXISTS idx_route_stops_agency_stop ON route_stops (agency_id, stop_id)`,
      `CREATE TABLE IF NOT EXISTS route_branches (
         id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
         agency_id uuid NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
         route_id character varying(100) NOT NULL,
         direction_id smallint,
         trip_headsign text,
         trip_id character varying(100) NOT NULL,
         shape_id character varying(100),
         stop_count integer NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_route_branches_agency_route ON route_branches (agency_id, route_id)`,
      // Added by synchronize in the release before migrations; in case a
      // database skipped that release.
      `ALTER TABLE agencies ADD COLUMN IF NOT EXISTS data_version integer DEFAULT 0 NOT NULL`,
    ];
    for (const sql of adHoc) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Only the indexes this migration introduced; the rest predate it.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stops_agency_parent_station`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stops_location_geography`);
  }
}
