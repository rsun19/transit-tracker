import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { Extract } from 'unzipper';
import csvParser from 'csv-parser';
import { from as copyFrom } from 'pg-copy-streams';
import type { Pool, PoolClient } from 'pg';
import { AgenciesService, ResolvedAgency } from '@/modules/agencies/agencies.service';

// Escape a value for PostgreSQL COPY CSV format (NULL → empty, strings quoted if needed)
function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// GTFS time strings may exceed 23:59:59 (e.g. "25:30:00" for post-midnight trips)
@Injectable()
export class GtfsStaticService {
  private readonly logger = new Logger(GtfsStaticService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly agenciesService: AgenciesService,
    private readonly configService: ConfigService,
  ) {}

  async ingestAgency(agencyConfig: ResolvedAgency): Promise<void> {
    this.logger.log(`Starting static ingestion for agency: ${agencyConfig.key}`);

    // 1. Download the ZIP
    this.logger.debug(`Downloading GTFS ZIP from: ${agencyConfig.gtfsStaticUrl}`);
    const zipPath = await this.downloadZip(agencyConfig);
    this.logger.debug(`Downloaded GTFS ZIP to: ${zipPath}`);

    // 2. Extract ZIP to a temp directory
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), `gtfs-${agencyConfig.key}-`));
    this.logger.debug(`Extracting GTFS ZIP to: ${extractDir}`);
    try {
      await this.extractZip(zipPath, extractDir);
      this.logger.debug(`GTFS ZIP extracted successfully`);

      // 3. Parse small CSV files into memory; stream large ones during transaction
      this.logger.debug(`Parsing routes, stops, trips, and calendars into memory...`);
      const [routes, stops, trips, calendars] = await Promise.all([
        this.parseCsv(path.join(extractDir, 'routes.txt')),
        this.parseCsv(path.join(extractDir, 'stops.txt')),
        this.parseCsv(path.join(extractDir, 'trips.txt')),
        this.parseCsv(path.join(extractDir, 'calendar.txt')),
      ]);
      this.logger.log(
        `Parsed: ${routes.length} routes, ${stops.length} stops, ${trips.length} trips, ${calendars.length} calendars`,
      );

      // 4. Atomic re-ingestion — shapes.txt (~21MB) and stop_times.txt (~196MB) are streamed
      this.logger.debug(`Starting atomic re-ingestion transaction...`);
      await this.atomicReingest(agencyConfig, {
        routes,
        stops,
        trips,
        calendars,
        shapesPath: path.join(extractDir, 'shapes.txt'),
        stopTimesPath: path.join(extractDir, 'stop_times.txt'),
      });

      this.logger.log(`✓ Ingestion complete for agency: ${agencyConfig.key}`);
    } catch (err) {
      this.logger.error(
        `Static ingestion failed for agency "${agencyConfig.key}": ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    } finally {
      // Clean up temp files
      this.logger.debug(`Cleaning up temp files from: ${extractDir}`);
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlink(zipPath, () => {}); // best-effort cleanup
    }
  }

  private async downloadZip(agencyConfig: ResolvedAgency): Promise<string> {
    const headers: Record<string, string> = {};
    if (agencyConfig.resolvedApiKey) {
      headers['x-api-key'] = agencyConfig.resolvedApiKey;
    }

    const response = await fetch(agencyConfig.gtfsStaticUrl, { headers });

    if (!response.ok) {
      throw new Error(
        `Failed to download GTFS feed for ${agencyConfig.key}: HTTP ${response.status}`,
      );
    }

    // Validate content type (FR-025: fail fast on malformed ZIP)
    const contentType = response.headers.get('content-type') ?? '';
    const isZip =
      contentType.includes('application/zip') ||
      contentType.includes('application/octet-stream') ||
      contentType.includes('application/x-zip-compressed');

    if (!isZip) {
      throw new Error(
        `GTFS feed for ${agencyConfig.key} returned unexpected Content-Type: ${contentType}`,
      );
    }

    const body = response.body;
    if (!body) {
      throw new Error(`GTFS feed for ${agencyConfig.key} returned empty body`);
    }

    // Sanity check minimum byte size
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) < 1024) {
      throw new Error(
        `GTFS feed for ${agencyConfig.key} is suspiciously small (${contentLength} bytes)`,
      );
    }

    const tmpPath = path.join(os.tmpdir(), `gtfs-${agencyConfig.key}-${Date.now()}.zip`);
    await pipeline(body as NodeJS.ReadableStream, createWriteStream(tmpPath));

    return tmpPath;
  }

  private async extractZip(zipPath: string, extractDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  }

  private parseCsv(filePath: string): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return resolve([]);
      }
      const rows: Record<string, string>[] = [];
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }

  private parseCsvOptional(filePath: string): Promise<Record<string, string>[]> {
    if (!fs.existsSync(filePath)) return Promise.resolve([]);
    return this.parseCsv(filePath);
  }

  private async streamInsert(
    filePath: string,
    batchSize: number,
    handler: (batch: Record<string, string>[]) => Promise<void>,
  ): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    let batch: Record<string, string>[] = [];
    for await (const row of fs.createReadStream(filePath).pipe(csvParser()) as AsyncIterable<
      Record<string, string>
    >) {
      batch.push(row);
      if (batch.length >= batchSize) {
        await handler(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await handler(batch);
  }

  private async atomicReingest(
    agencyConfig: ResolvedAgency,
    data: {
      routes: Record<string, string>[];
      stops: Record<string, string>[];
      trips: Record<string, string>[];
      calendars: Record<string, string>[];
      shapesPath: string;
      stopTimesPath: string;
    },
  ): Promise<void> {
    // Use auto-committed individual queries — a single transaction spanning 1.4M
    // stop_times rows causes PostgreSQL WAL overflow and crashes.
    const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> =>
      this.dataSource.query(sql, params);

    // 1. Upsert agency
    const agencyResult = await q<Array<{ agencyId: string }>>(
      `INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url, gtfs_realtime_url, api_key_env_var)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agency_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         timezone = EXCLUDED.timezone,
         gtfs_static_url = EXCLUDED.gtfs_static_url,
         gtfs_realtime_url = EXCLUDED.gtfs_realtime_url,
         api_key_env_var = EXCLUDED.api_key_env_var
       RETURNING "agencyId"`,
      [
        agencyConfig.key,
        agencyConfig.displayName,
        agencyConfig.timezone,
        agencyConfig.gtfsStaticUrl,
        agencyConfig.gtfsRealtimeUrl ?? null,
        agencyConfig.apiKeyEnvVar ?? null,
      ],
    );
    const agencyId: string = agencyResult[0].agencyId;

    // 2. Drop any shadow/old tables left over from a previous failed run, then
    // create fresh shadow tables. All new data is loaded into the _new tables
    // while the live tables remain fully queryable. A near-instant DDL rename
    // then atomically replaces the live tables — zero downtime.
    this.logger.debug(`Dropping any leftover shadow tables from a previous run...`);
    await this.dropShadowTables(q);

    this.logger.debug(`Creating shadow tables for zero-downtime swap...`);
    await this.createShadowTables(q);

    try {
      // 3. Set large shadow tables UNLOGGED — eliminates WAL writes during bulk
      // insert, preventing checkpoint I/O thrashing that causes OOM kills on
      // low-memory hosts. Crash recovery re-triggers ingestion, so WAL is not needed.
      await q(`ALTER TABLE stop_times_new SET UNLOGGED`).catch(() => {});
      await q(`ALTER TABLE shapes_new SET UNLOGGED`).catch(() => {});

      const BATCH = 500;

      // 4. Insert routes into routes_new — 7 params per row
      const routes = data.routes;
      (data as { routes: unknown }).routes = [];
      this.logger.debug(`Inserting ${routes.length} routes in batches of ${BATCH}...`);
      for (let i = 0; i < routes.length; i += BATCH) {
        const batch = routes.slice(i, i + BATCH);
        const values: unknown[] = [];
        const rows = batch.map((row, idx) => {
          const b = idx * 7;
          values.push(
            agencyId,
            row['route_id'],
            row['route_short_name'] ?? null,
            row['route_long_name'] ?? null,
            parseInt(row['route_type'] ?? '3', 10),
            row['route_color'] ?? null,
            row['route_text_color'] ?? null,
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
        });
        await q(
          `INSERT INTO routes_new (agency_id,route_id,short_name,long_name,route_type,color,text_color) VALUES ${rows.join(',')}`,
          values,
        );
      }
      this.logger.log(`✓ Routes inserted: ${routes.length}`);

      // 5. Insert stops into stops_new — 8 params per row (lat=$5, lon=$6 → MakePoint(lon,lat))
      const stops = data.stops;
      (data as { stops: unknown }).stops = [];
      for (let i = 0; i < stops.length; i += BATCH) {
        const batch = stops.slice(i, i + BATCH);
        const values: unknown[] = [];
        const rows = batch.map((row, idx) => {
          const b = idx * 8;
          values.push(
            agencyId,
            row['stop_id'],
            row['stop_name'],
            row['stop_code'] ?? null,
            parseFloat(row['stop_lat'] ?? '0'),
            parseFloat(row['stop_lon'] ?? '0'),
            row['parent_station'] ?? null,
            row['wheelchair_boarding'] ? parseInt(row['wheelchair_boarding'], 10) : null,
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},ST_SetSRID(ST_MakePoint($${b + 6},$${b + 5}),4326),$${b + 7},$${b + 8})`;
        });
        await q(
          `INSERT INTO stops_new (agency_id,stop_id,stop_name,stop_code,location,parent_station_id,wheelchair_boarding) VALUES ${rows.join(',')}`,
          values,
        );
      }
      this.logger.log(`✓ Stops inserted: ${stops.length}`);

      // Build GIN trigram indexes on stops_new — single-pass build is far cheaper
      // than per-row GIN updates during INSERT.
      this.logger.debug(`Building stop GIN trigram indexes on shadow table...`);
      await q(
        `CREATE INDEX idx_stops_stop_name_trgm_new ON stops_new USING gin (stop_name gin_trgm_ops)`,
      );
      await q(
        `CREATE INDEX idx_stops_stop_code_trgm_new ON stops_new USING gin (stop_code gin_trgm_ops)`,
      );
      this.logger.log(`✓ Stop GIN trigram indexes built`);

      // 6. Insert trips into trips_new — 8 params per row
      const trips = data.trips;
      (data as { trips: unknown }).trips = [];
      this.logger.debug(`Inserting ${trips.length} trips in batches of ${BATCH}...`);
      for (let i = 0; i < trips.length; i += BATCH) {
        const batch = trips.slice(i, i + BATCH);
        const values: unknown[] = [];
        const rows = batch.map((row, idx) => {
          const b = idx * 8;
          values.push(
            agencyId,
            row['trip_id'],
            row['route_id'],
            row['service_id'],
            row['trip_headsign'] ?? null,
            row['direction_id'] ? parseInt(row['direction_id'], 10) : null,
            row['shape_id'] ?? null,
            row['wheelchair_accessible'] ? parseInt(row['wheelchair_accessible'], 10) : null,
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
        });
        await q(
          `INSERT INTO trips_new (agency_id,trip_id,route_id,service_id,trip_headsign,direction_id,shape_id,wheelchair_accessible) VALUES ${rows.join(',')}`,
          values,
        );
      }
      this.logger.log(`✓ Trips inserted: ${trips.length}`);

      // 7. Stream shapes into shapes_new via COPY FROM STDIN
      this.logger.debug(`Streaming shapes via COPY FROM STDIN into shadow table...`);
      await this.copyShapes(data.shapesPath, agencyId, 'shapes_new');
      this.logger.log(`✓ Shapes inserted (via COPY)`);

      // 8. Insert service calendars into service_calendars_new — 11 params per row
      this.logger.debug(
        `Inserting ${data.calendars.length} service calendars in batches of ${BATCH}...`,
      );
      for (let i = 0; i < data.calendars.length; i += BATCH) {
        const batch = data.calendars.slice(i, i + BATCH);
        const values: unknown[] = [];
        const rows = batch.map((row, idx) => {
          const b = idx * 11;
          values.push(
            agencyId,
            row['service_id'],
            row['monday'] === '1',
            row['tuesday'] === '1',
            row['wednesday'] === '1',
            row['thursday'] === '1',
            row['friday'] === '1',
            row['saturday'] === '1',
            row['sunday'] === '1',
            row['start_date'],
            row['end_date'],
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
        });
        await q(
          `INSERT INTO service_calendars_new (agency_id,service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date) VALUES ${rows.join(',')}`,
          values,
        );
      }
      this.logger.log(`✓ Service calendars inserted: ${data.calendars.length}`);

      // 9. Stream stop_times into stop_times_new via COPY FROM STDIN
      this.logger.debug(
        `Streaming stop_times via COPY FROM STDIN into shadow table (this will take 5-10 minutes)...`,
      );
      await this.copyStopTimes(data.stopTimesPath, agencyId, 'stop_times_new');
      this.logger.log(`✓ Stop times inserted (via COPY)`);

      // 10. Build stop_times indexes on shadow table — single sort-based pass.
      // Higher maintenance_work_mem lets PostgreSQL sort in memory rather than spill to disk.
      this.logger.debug(`Building stop_times indexes on shadow table (single-pass sort)...`);
      // Use a dedicated QueryRunner so SET maintenance_work_mem applies to the same
      // connection as the subsequent CREATE INDEX calls. this.dataSource.query() is
      // pooled and may acquire a different connection for each await.
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      try {
        await qr.query(`SET maintenance_work_mem = '256MB'`);
        await qr.query(
          `CREATE INDEX idx_stop_times_agency_stop_dept_new ON stop_times_new (agency_id, stop_id, departure_time)`,
        );
        await qr.query(
          `CREATE INDEX idx_stop_times_agency_trip_seq_new ON stop_times_new (agency_id, trip_id, stop_sequence)`,
        );
        await qr.query(`RESET maintenance_work_mem`);
      } finally {
        await qr.release();
      }
      this.logger.log(`✓ stop_times indexes built`);

      // 11. CLUSTER stop_times_new (if enabled) — physically reorders heap for sequential I/O.
      // Runs on the shadow table so the live table is never locked for ~2 minutes.
      if (this.configService.get<string>('GTFS_CLUSTER_STOP_TIMES') === 'true') {
        this.logger.debug(`Clustering stop_times_new on stop_id index (may take ~2 minutes)...`);
        await q(`CLUSTER stop_times_new USING idx_stop_times_agency_stop_dept_new`);
        this.logger.log(`✓ stop_times_new clustered`);
      } else {
        this.logger.log(
          `Skipping CLUSTER (set GTFS_CLUSTER_STOP_TIMES=true to enable — takes ACCESS EXCLUSIVE lock ~2 min)`,
        );
      }

      // 12. Prune orphan stops from stops_new (no stop_times and not a parent station).
      this.logger.debug(`Pruning orphan stops from shadow table...`);
      const pruneResult = await q<Array<{ count: string }>>(
        `WITH deleted AS (
           DELETE FROM stops_new
           WHERE agency_id = $1
             AND NOT EXISTS (
               SELECT 1 FROM stop_times_new st
               WHERE st.stop_id = stops_new.stop_id AND st.agency_id = stops_new.agency_id
             )
             AND stop_id NOT IN (
               SELECT DISTINCT parent_station_id FROM stops_new
               WHERE agency_id = $1 AND parent_station_id IS NOT NULL
             )
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM deleted`,
        [agencyId],
      );
      this.logger.log(`✓ Orphan stops pruned: ${pruneResult[0]?.count ?? 0}`);

      // 13. Convert UNLOGGED shadow tables back to LOGGED before swap.
      // UNLOGGED is safe during bulk load (no WAL, no crash recovery needed for shadow tables),
      // but the property persists through RENAME — leaving the promoted live tables UNLOGGED
      // would truncate them on crash recovery and destroy all production data.
      await q(`ALTER TABLE stop_times_new SET LOGGED`).catch(() => {});
      await q(`ALTER TABLE shapes_new SET LOGGED`).catch(() => {});

      // 14. Atomic rename — shadow tables replace live tables in a single DDL transaction.
      // Live tables remain fully queryable right up until this commit (milliseconds).
      this.logger.debug(`Swapping shadow tables into place (atomic rename)...`);
      await this.swapTables(q);
      this.logger.log(`✓ Shadow tables swapped into place`);

      // 14. Refresh planner statistics on the now-live tables.
      this.logger.debug(`Analyzing ingested tables...`);
      await Promise.all([
        q(`ANALYZE stop_times`),
        q(`ANALYZE trips`),
        q(`ANALYZE stops`),
        q(`ANALYZE routes`),
        q(`ANALYZE service_calendars`),
      ]);
      this.logger.log(`✓ Table statistics refreshed`);

      // 15. Mark ingested
      this.logger.debug(`Marking agency as ingested...`);
      await q(`UPDATE agencies SET last_ingested_at = NOW() WHERE "agencyId" = $1`, [agencyId]);
      this.logger.log(`✓ Agency marked as ingested`);
    } catch (err) {
      // Drop shadow tables so they don't block the next ingestion run.
      this.logger.warn(`Ingestion failed — dropping shadow tables for cleanup...`);
      await this.dropShadowTables(q).catch((cleanupErr: unknown) => {
        this.logger.warn(
          `Failed to drop shadow tables during error cleanup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
      });
      throw err;
    }
  }

  // Creates empty shadow tables (_new suffix) with the same schema as the live tables.
  // All FK constraints reference agencies only — there are no cross-FKs between GTFS
  // tables, so renaming is safe. The _new suffix indexes are renamed during swapTables().
  private async createShadowTables(
    q: (sql: string, params?: unknown[]) => Promise<unknown>,
  ): Promise<void> {
    await q(`
      CREATE TABLE routes_new (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id     UUID        NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        route_id      VARCHAR(100) NOT NULL,
        short_name    VARCHAR(50),
        long_name     TEXT,
        route_type    SMALLINT    NOT NULL,
        color         VARCHAR(6),
        text_color    VARCHAR(6),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (agency_id, route_id)
      )
    `);
    await q(`CREATE INDEX ON routes_new (agency_id, route_type)`);
    await q(`
      CREATE TABLE stops_new (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id           UUID         NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        stop_id             VARCHAR(100) NOT NULL,
        stop_name           TEXT         NOT NULL,
        stop_code           VARCHAR(50),
        location            GEOMETRY(Point, 4326) NOT NULL,
        parent_station_id   VARCHAR(100),
        wheelchair_boarding SMALLINT,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (agency_id, stop_id)
      )
    `);
    await q(`CREATE INDEX ON stops_new (agency_id, stop_code)`);
    await q(`CREATE INDEX ON stops_new USING GIST (location)`);
    await q(`
      CREATE TABLE trips_new (
        id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id            UUID         NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        trip_id              VARCHAR(100) NOT NULL,
        route_id             VARCHAR(100) NOT NULL,
        service_id           VARCHAR(100) NOT NULL,
        trip_headsign        TEXT,
        direction_id         SMALLINT,
        shape_id             VARCHAR(100),
        wheelchair_accessible SMALLINT,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        UNIQUE (agency_id, trip_id)
      )
    `);
    await q(`CREATE INDEX ON trips_new (agency_id, route_id)`);
    await q(`CREATE INDEX ON trips_new (agency_id, service_id)`);
    await q(`
      CREATE TABLE shapes_new (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id   UUID         NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        shape_id    VARCHAR(100) NOT NULL,
        pt_sequence INTEGER      NOT NULL,
        location    GEOMETRY(Point, 4326) NOT NULL
      )
    `);
    await q(`CREATE INDEX ON shapes_new (agency_id, shape_id, pt_sequence)`);
    await q(`
      CREATE TABLE service_calendars_new (
        id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id  UUID         NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        service_id VARCHAR(100) NOT NULL,
        monday     BOOLEAN      NOT NULL DEFAULT false,
        tuesday    BOOLEAN      NOT NULL DEFAULT false,
        wednesday  BOOLEAN      NOT NULL DEFAULT false,
        thursday   BOOLEAN      NOT NULL DEFAULT false,
        friday     BOOLEAN      NOT NULL DEFAULT false,
        saturday   BOOLEAN      NOT NULL DEFAULT false,
        sunday     BOOLEAN      NOT NULL DEFAULT false,
        start_date DATE         NOT NULL,
        end_date   DATE         NOT NULL,
        UNIQUE (agency_id, service_id)
      )
    `);
    await q(`
      CREATE TABLE stop_times_new (
        id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id      UUID         NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
        trip_id        VARCHAR(100) NOT NULL,
        stop_id        VARCHAR(100) NOT NULL,
        stop_sequence  INTEGER      NOT NULL,
        arrival_time   INTERVAL,
        departure_time INTERVAL,
        stop_headsign  TEXT,
        pickup_type    SMALLINT,
        drop_off_type  SMALLINT
      )
    `);
  }

  // Drops shadow (_new) and old (_old) tables, ignoring errors for tables that
  // don't exist. Called at the start of ingestion to clean up after failed runs,
  // and in the catch block if the current run fails mid-way.
  private async dropShadowTables(
    q: (sql: string, params?: unknown[]) => Promise<unknown>,
  ): Promise<void> {
    for (const table of [
      'stop_times_new',
      'shapes_new',
      'service_calendars_new',
      'trips_new',
      'stops_new',
      'routes_new',
      'stop_times_old',
      'shapes_old',
      'service_calendars_old',
      'trips_old',
      'stops_old',
      'routes_old',
    ]) {
      await q(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
    }
  }

  // Atomically replaces live tables with shadow tables via DDL rename.
  //
  // Phase 1 (pre-swap): renames well-known index names on the live tables to
  //   avoid conflicts — IF EXISTS so this is a no-op on first-ever ingestion.
  // Phase 2 (atomic): renames all live → _old and all _new → live in one
  //   BEGIN/COMMIT transaction. Holds ACCESS EXCLUSIVE locks only for the
  //   duration of the rename (milliseconds).
  // Phase 3a (post-swap): renames explicitly-tracked _new-suffixed indexes.
  // Phase 3b (post-swap): reconciles all remaining constraints and indexes
  //   (PK, unique, and regular) using _old tables as the canonical name source.
  //   This prevents TypeORM synchronize from failing on the next startup due to
  //   mismatched constraint/index names (e.g. stops_new_agency_id_stop_id_key
  //   vs the UQ_<hash> that TypeORM expects to find).
  // Phase 4 (cleanup): drops the _old tables (and their indexes) immediately.
  private async swapTables(
    q: (sql: string, params?: unknown[]) => Promise<unknown>,
  ): Promise<void> {
    // Phase 1: park old index names out of the way.
    for (const [from, to] of [
      ['idx_stop_times_agency_stop_dept', 'idx_stop_times_agency_stop_dept_old'],
      ['idx_stop_times_agency_trip_seq', 'idx_stop_times_agency_trip_seq_old'],
      ['idx_stops_stop_name_trgm', 'idx_stops_stop_name_trgm_old'],
      ['idx_stops_stop_code_trgm', 'idx_stops_stop_code_trgm_old'],
    ] as [string, string][]) {
      await q(`ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`).catch(() => {});
    }

    // Phase 2: atomic table rename.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgPool: Pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const client: PoolClient = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const [from, to] of [
        ['routes', 'routes_old'],
        ['stops', 'stops_old'],
        ['trips', 'trips_old'],
        ['shapes', 'shapes_old'],
        ['service_calendars', 'service_calendars_old'],
        ['stop_times', 'stop_times_old'],
        ['routes_new', 'routes'],
        ['stops_new', 'stops'],
        ['trips_new', 'trips'],
        ['shapes_new', 'shapes'],
        ['service_calendars_new', 'service_calendars'],
        ['stop_times_new', 'stop_times'],
      ] as [string, string][]) {
        await client.query(`ALTER TABLE "${from}" RENAME TO "${to}"`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Compensate Phase 1: restore the parked index names so the live table indexes
      // keep their expected names after a failed swap. Uses IF EXISTS + .catch so a
      // partially-complete rename or missing index never masks the original error.
      for (const [from, to] of [
        ['idx_stop_times_agency_stop_dept_old', 'idx_stop_times_agency_stop_dept'],
        ['idx_stop_times_agency_trip_seq_old', 'idx_stop_times_agency_trip_seq'],
        ['idx_stops_stop_name_trgm_old', 'idx_stops_stop_name_trgm'],
        ['idx_stops_stop_code_trgm_old', 'idx_stops_stop_code_trgm'],
      ] as [string, string][]) {
        await q(`ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`).catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }

    // Phase 3a: rename the explicitly-tracked _new-suffixed indexes.
    for (const [from, to] of [
      ['idx_stop_times_agency_stop_dept_new', 'idx_stop_times_agency_stop_dept'],
      ['idx_stop_times_agency_trip_seq_new', 'idx_stop_times_agency_trip_seq'],
      ['idx_stops_stop_name_trgm_new', 'idx_stops_stop_name_trgm'],
      ['idx_stops_stop_code_trgm_new', 'idx_stops_stop_code_trgm'],
    ] as [string, string][]) {
      await q(`ALTER INDEX "${from}" RENAME TO "${to}"`).catch(() => {});
    }

    // Phase 3b: collect canonical constraint/index names.
    //
    // For PK and UQ constraints → use TypeORM's DataSource entity metadata as the
    // authoritative source. This is deterministic and does NOT depend on the _old
    // tables' constraint names (which could be stale after a prior failed ingestion).
    //
    // For regular (non-PK, non-UQ) indexes → read from _old tables using a
    // pg_class OID join (avoids the ::regclass cast that fails when the same
    // index name exists on both the live and _old table simultaneously).
    type ConRow = { conname: string; cols: string };
    type IdxRow = { indexname: string; cols: string; index_type: string };

    // Build canonical PK and UQ info from TypeORM entity metadata.
    const strategy = this.dataSource.namingStrategy;
    const entityCanonical = new Map<
      string,
      { pkName: string; uqNames: Array<{ name: string; cols: string }> }
    >();
    for (const meta of this.dataSource.entityMetadatas) {
      const pkCols = meta.primaryColumns.map((c) => c.databaseName);
      const pkName = strategy.primaryKeyName(meta.tableName, pkCols);
      const uqNames = meta.uniques.map((uq) => ({
        name: strategy.uniqueConstraintName(
          meta.tableName,
          uq.columns.map((c) => c.databaseName),
        ),
        cols: uq.columns
          .map((c) => c.databaseName)
          .sort()
          .join(','),
      }));
      entityCanonical.set(meta.tableName, { pkName, uqNames });
    }

    // Uses pg_class OID join — avoids the ::regclass cast that fails when a
    // same-named index exists on both the live and _old table simultaneously.
    const idxSql = `
      SELECT ix.indexname,
             string_agg(a.attname, ',' ORDER BY array_position(i.indkey::int[], a.attnum::int)) AS cols,
             am.amname AS index_type
      FROM pg_indexes ix
      JOIN pg_namespace ns ON ns.nspname = ix.schemaname
      JOIN pg_class     t  ON t.relname = ix.tablename AND t.relnamespace = ns.oid AND t.relkind = 'r'
      JOIN pg_class     ic ON ic.relname = ix.indexname AND ic.relnamespace = ns.oid AND ic.relkind = 'i'
      JOIN pg_index     i  ON i.indexrelid = ic.oid
      JOIN pg_am        am ON am.oid = ic.relam
      JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey) AND a.attnum > 0
      WHERE t.relname = $1 AND NOT i.indisunique AND NOT i.indisprimary
      GROUP BY ix.indexname, am.amname`;

    const tablePairs = [
      ['routes', 'routes_old'],
      ['stops', 'stops_old'],
      ['trips', 'trips_old'],
      ['shapes', 'shapes_old'],
      ['service_calendars', 'service_calendars_old'],
      ['stop_times', 'stop_times_old'],
    ] as [string, string][];

    const canonicalInfo: Array<{
      liveTable: string;
      oldPKs: ConRow[];
      oldUQs: ConRow[];
      oldIdxs: IdxRow[];
    }> = [];

    for (const [liveTable, oldTable] of tablePairs) {
      // PK and UQ come from TypeORM DataSource (authoritative).
      const entityInfo = entityCanonical.get(liveTable);
      const oldPKs: ConRow[] = entityInfo
        ? [
            {
              conname: entityInfo.pkName,
              cols: (
                this.dataSource.entityMetadatas
                  .find((m) => m.tableName === liveTable)
                  ?.primaryColumns.map((c) => c.databaseName) ?? []
              ).join(','),
            },
          ]
        : [];
      const oldUQs: ConRow[] = (entityInfo?.uqNames ?? []).map((uq) => ({
        conname: uq.name,
        cols: uq.cols,
      }));

      // Regular index names still come from the _old table (captures IDX_<hash>
      // names that TypeORM synchronize may have created/corrected on a prior run).
      const oldIdxs = await q(idxSql, [oldTable]).then((r) => r as IdxRow[]);
      canonicalInfo.push({ liveTable, oldPKs, oldUQs, oldIdxs });
    }

    // Phase 4: drop old tables (also drops their indexes and frees canonical names).
    for (const table of [
      'stop_times_old',
      'shapes_old',
      'service_calendars_old',
      'trips_old',
      'stops_old',
      'routes_old',
    ]) {
      await q(`DROP TABLE IF EXISTS "${table}"`);
    }

    // Phase 5: reconcile live tables now that _old tables are gone and canonical
    // constraint/index names are no longer in use anywhere.
    for (const { liveTable, oldPKs, oldUQs, oldIdxs } of canonicalInfo) {
      await this.reconcileConstraintsAndIndexes(q, liveTable, oldPKs, oldUQs, oldIdxs);
    }
  }

  // Renames any mismatched PK constraints, unique constraints, and regular indexes
  // on `liveTable` to match the canonical names supplied via `oldPKs`/`oldUQs`/`oldIdxs`
  // (collected from the corresponding _old table before it was dropped).
  //
  // Matching is done by column fingerprint (sorted column names + index type).
  // Names ending in '_old' are skipped — they were parked by Phase 1 and already
  // handled by Phase 3a.
  //
  // All renames use .catch(() => {}) so a stale/duplicate name never aborts the swap.
  private async reconcileConstraintsAndIndexes(
    q: (sql: string, params?: unknown[]) => Promise<unknown>,
    liveTable: string,
    oldPKs: { conname: string; cols: string }[],
    oldUQs: { conname: string; cols: string }[],
    oldIdxs: { indexname: string; cols: string; index_type: string }[],
  ): Promise<void> {
    type ConRow = { conname: string; cols: string };
    type IdxRow = { indexname: string; cols: string; index_type: string };

    const constraintSql = `
      SELECT c.conname,
             string_agg(a.attname, ',' ORDER BY array_position(c.conkey::int[], a.attnum::int)) AS cols
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE t.relname = $1 AND c.contype = $2
      GROUP BY c.conname`;

    const indexSql = `
      SELECT ix.indexname,
             string_agg(a.attname, ',' ORDER BY array_position(i.indkey::int[], a.attnum::int)) AS cols,
             am.amname AS index_type
      FROM pg_indexes ix
      JOIN pg_namespace ns ON ns.nspname = ix.schemaname
      JOIN pg_class     t  ON t.relname = ix.tablename AND t.relnamespace = ns.oid AND t.relkind = 'r'
      JOIN pg_class     ic ON ic.relname = ix.indexname AND ic.relnamespace = ns.oid AND ic.relkind = 'i'
      JOIN pg_index     i  ON i.indexrelid = ic.oid
      JOIN pg_am        am ON am.oid = ic.relam
      JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey) AND a.attnum > 0
      WHERE t.relname = $1 AND NOT i.indisunique AND NOT i.indisprimary
      GROUP BY ix.indexname, am.amname`;

    const getLiveConstraints = async (type: 'p' | 'u'): Promise<ConRow[]> =>
      (await q(constraintSql, [liveTable, type])) as ConRow[];
    const getLiveIndexes = async (): Promise<IdxRow[]> =>
      (await q(indexSql, [liveTable])) as IdxRow[];

    // Reconcile PK constraints (e.g. stops_new_pkey → pk_<hash>)
    const livePKs = await getLiveConstraints('p');
    for (const old of oldPKs) {
      if (old.conname.endsWith('_old')) continue;
      const live = livePKs.find((c) => c.cols === old.cols);
      if (live && live.conname !== old.conname) {
        await q(
          `ALTER TABLE "${liveTable}" RENAME CONSTRAINT "${live.conname}" TO "${old.conname}"`,
        ).catch(() => {});
      }
    }

    // Reconcile unique constraints (e.g. stops_new_agency_id_stop_id_key → UQ_<hash>)
    const liveUQs = await getLiveConstraints('u');
    for (const old of oldUQs) {
      if (old.conname.endsWith('_old')) continue;
      const live = liveUQs.find((c) => c.cols === old.cols);
      if (live && live.conname !== old.conname) {
        await q(
          `ALTER TABLE "${liveTable}" RENAME CONSTRAINT "${live.conname}" TO "${old.conname}"`,
        ).catch(() => {});
      }
    }

    // Reconcile regular (non-unique, non-PK) indexes (e.g. IDX_<hash> mismatch)
    const liveIdxs = await getLiveIndexes();
    for (const old of oldIdxs) {
      if (old.indexname.endsWith('_old')) continue;
      const live = liveIdxs.find((i) => i.cols === old.cols && i.index_type === old.index_type);
      if (live && live.indexname !== old.indexname) {
        await q(`ALTER INDEX "${live.indexname}" RENAME TO "${old.indexname}"`).catch(() => {});
      }
    }
  }

  // --- COPY FROM STDIN helpers (used for large tables to avoid OOM) --------

  private async copyShapes(
    filePath: string,
    agencyId: string,
    tableName = 'shapes',
  ): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgPool: Pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const pgClient: PoolClient = await pgPool.connect();
    try {
      let shapeRowCount = 0;
      await new Promise<void>((resolve, reject) => {
        const copyStream = pgClient.query(
          copyFrom(
            `COPY ${tableName} (agency_id,shape_id,pt_sequence,location) FROM STDIN WITH (FORMAT csv, NULL '')`, // eslint-disable-line @typescript-eslint/restrict-template-expressions
          ),
        );
        const readStream = fs.createReadStream(filePath);
        const csvStream = readStream.pipe(csvParser());
        let waitingForDrain = false;
        let settled = false;
        const finalize = (err?: Error): void => {
          if (settled) return;
          settled = true;
          pgClient.off('error', onClientError);
          copyStream.off('finish', onFinish);
          csvStream.off('error', onStreamError);
          if (err) {
            reject(err);
            return;
          }
          resolve();
        };
        const onStreamError = (err: Error): void => {
          this.logger.error(`copyShapes error after ${shapeRowCount} rows: ${err.message}`);
          copyStream.destroy(err);
          readStream.destroy(err);
          finalize(err);
        };
        const onClientError = (err: Error): void => {
          this.logger.error(
            `copyShapes database connection error after ${shapeRowCount} rows: ${err.message}`,
          );
          readStream.destroy(err);
          finalize(err);
        };
        const onCopyError = (err: Error): void => {
          if (settled) {
            this.logger.warn(`copyShapes late stream error after settlement: ${err.message}`);
            return;
          }
          this.logger.error(`copyShapes stream error after ${shapeRowCount} rows: ${err.message}`);
          readStream.destroy(err);
          finalize(err);
        };
        const onFinish = (): void => {
          this.logger.debug(`copyShapes completed: ${shapeRowCount} rows`);
          finalize();
        };
        pgClient.on('error', onClientError);
        copyStream.on('error', onCopyError);
        copyStream.on('finish', onFinish);
        csvStream.on('data', (row: Record<string, string>) => {
          shapeRowCount++;
          const lat = parseFloat(row['shape_pt_lat'] ?? '0');
          const lon = parseFloat(row['shape_pt_lon'] ?? '0');
          const seq = parseInt(row['shape_pt_sequence'] ?? '0', 10);
          const line = `${agencyId},${csvField(row['shape_id'])},${seq},SRID=4326;POINT(${lon} ${lat})\n`;
          if (!copyStream.write(line)) {
            csvStream.pause();
            if (!waitingForDrain) {
              waitingForDrain = true;
              copyStream.once('drain', () => {
                waitingForDrain = false;
                csvStream.resume();
              });
            }
          }
        });
        csvStream.on('end', () => {
          this.logger.debug(`copyShapes stream ended at ${shapeRowCount} rows`);
          copyStream.end();
        });
        csvStream.on('error', onStreamError);
      });
    } finally {
      pgClient.release();
    }
  }

  private async copyStopTimes(
    filePath: string,
    agencyId: string,
    tableName = 'stop_times',
  ): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgPool: Pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const pgClient: PoolClient = await pgPool.connect();
    try {
      let stopTimesRowCount = 0;
      let streamEnded = false;
      const startTime = Date.now();

      await new Promise<void>((resolve, reject) => {
        const copyStream = pgClient.query(
          copyFrom(
            `COPY ${tableName} (agency_id,trip_id,stop_id,stop_sequence,arrival_time,departure_time,stop_headsign,pickup_type,drop_off_type) FROM STDIN WITH (FORMAT csv, NULL '')`, // eslint-disable-line @typescript-eslint/restrict-template-expressions
          ),
        );
        const readStream = fs.createReadStream(filePath);
        const csvStream = readStream.pipe(csvParser());
        let waitingForDrain = false;
        let settled = false;
        let copyFinishTimeout: NodeJS.Timeout | undefined;

        const finalize = (err?: Error): void => {
          if (settled) return;
          settled = true;
          if (copyFinishTimeout) clearTimeout(copyFinishTimeout);
          pgClient.off('error', onClientError);
          copyStream.off('finish', onFinish);
          copyStream.off('close', onClose);
          csvStream.off('error', onStreamError);
          if (err) {
            reject(err);
            return;
          }
          resolve();
        };

        const onStreamError = (err: Error): void => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          this.logger.error(
            `copyStopTimes error after ${stopTimesRowCount} rows (~${elapsed}s): ${err.message}`,
          );
          copyStream.destroy(err);
          readStream.destroy(err);
          finalize(err);
        };

        const onClientError = (err: Error): void => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          this.logger.error(
            `copyStopTimes database connection error after ${stopTimesRowCount} rows (~${elapsed}s): ${err.message}`,
          );
          readStream.destroy(err);
          finalize(err);
        };

        const onCopyError = (err: Error): void => {
          if (settled) {
            this.logger.warn(`copyStopTimes late stream error after settlement: ${err.message}`);
            return;
          }
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          this.logger.error(
            `copyStopTimes stream error after ${stopTimesRowCount} rows (~${elapsed}s): ${err.message}`,
          );
          readStream.destroy(err);
          finalize(err);
        };

        const onFinish = (): void => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          if (streamEnded) {
            this.logger.log(`copyStopTimes completed: ${stopTimesRowCount} rows in ~${elapsed}s`);
          }
          finalize();
        };

        const onClose = (): void => {
          if (settled) return;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          if (streamEnded) {
            this.logger.log(`copyStopTimes completed: ${stopTimesRowCount} rows in ~${elapsed}s`);
            finalize();
            return;
          }
          finalize(new Error('COPY stream closed before CSV input completed'));
        };

        pgClient.on('error', onClientError);
        copyStream.on('error', onCopyError);
        copyStream.on('finish', onFinish);
        copyStream.on('close', onClose);

        csvStream.on('data', (row: Record<string, string>) => {
          stopTimesRowCount++;
          if (stopTimesRowCount % 100_000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            this.logger.log(`copyStopTimes progress: ${stopTimesRowCount} rows (~${elapsed}s)`);
          }
          // GTFS times like "25:30:00" are valid PostgreSQL interval literals — no conversion needed
          const line =
            [
              agencyId,
              csvField(row['trip_id']),
              csvField(row['stop_id']),
              row['stop_sequence'] ?? '0',
              row['arrival_time'] ?? '',
              row['departure_time'] ?? '',
              csvField(row['stop_headsign'] ?? null),
              row['pickup_type'] ?? '',
              row['drop_off_type'] ?? '',
            ].join(',') + '\n';
          if (!copyStream.write(line)) {
            csvStream.pause();
            if (!waitingForDrain) {
              waitingForDrain = true;
              copyStream.once('drain', () => {
                waitingForDrain = false;
                csvStream.resume();
              });
            }
          }
        });

        csvStream.on('end', () => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          this.logger.debug(
            `copyStopTimes CSV stream ended at ${stopTimesRowCount} rows (~${elapsed}s), waiting for COPY to finish...`,
          );
          streamEnded = true;
          copyStream.end();
          copyFinishTimeout = setTimeout(() => {
            if (settled) return;
            finalize(
              new Error(
                `copyStopTimes timed out waiting for COPY to finish after streaming ${stopTimesRowCount} rows`,
              ),
            );
          }, 300_000);
        });

        csvStream.on('error', onStreamError);
      });
    } finally {
      pgClient.release();
    }
  }
}
