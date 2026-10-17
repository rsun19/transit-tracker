import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan 09: query statistics, and two indexes nothing uses.
 *
 * pg_stat_statements records per-query timings; the db service preloads its
 * library (shared_preload_libraries), without which the view errors on read.
 *
 * Dropped (production pg_stat_user_indexes, 2026-10-17: 1 scan each since the
 * database was created, but written on every static load):
 * - routes (agency_id, route_type): the route_type filter runs over ~400 rows.
 * - stops (agency_id, stop_code): stop-code search uses idx_stops_stop_code_trgm.
 */
export class StatStatementsAndUnusedIndexes1792281600000 implements MigrationInterface {
  name = 'StatStatementsAndUnusedIndexes1792281600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_8da8e722bebe8fbcf8fe9f4f54"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ea6f3c5b16a6649a36584ca6c0"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_8da8e722bebe8fbcf8fe9f4f54" ON routes (agency_id, route_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ea6f3c5b16a6649a36584ca6c0" ON stops (agency_id, stop_code)`,
    );
  }
}
