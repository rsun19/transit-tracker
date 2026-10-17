import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { agencyAuthHeaders } from '@transit-tracker/shared';
import type { ResolvedAgency } from '@transit-tracker/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import csvParser from 'csv-parser';
import { from as copyFrom } from 'pg-copy-streams';
import type { PoolClient } from 'pg';
import { byteLimit, extractGtfsFiles } from './static/extract';
import { colocatedGroups } from './static/colocated';
import {
  CALENDAR_FILES,
  CORE_TABLES,
  MIN_ROW_RATIO,
  REQUIRED_FILES,
  STAGED_TABLES,
  copyLine,
  type TableSpec,
} from './static/gtfs-rows';

// The static zip is about 25 MB; these only stop a hung or runaway download
// from blocking ingestion (and filling the disk) indefinitely.
export const STATIC_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
export const STATIC_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

const COPY_CHUNK_ROWS = 1000;

// Tables computed from the staged GTFS tables, swapped in with them.
const ROUTE_STOPS_COLUMNS = [
  'agency_id',
  'stop_id',
  'route_id',
  'short_name',
  'long_name',
  'route_type',
];
const ROUTE_BRANCHES_COLUMNS = [
  'agency_id',
  'route_id',
  'direction_id',
  'trip_headsign',
  'trip_id',
  'shape_id',
  'stop_count',
];

/** Every live table the load replaces, with the columns copied from staging. */
export const SWAPPED_TABLES: Array<{ table: string; columns: string[] }> = [
  ...STAGED_TABLES.map((t) => ({
    table: t.table,
    columns:
      t.table === 'stops'
        ? [...t.columns, 'colocated_group_id']
        : t.table === 'routes'
          ? [...t.columns, 'has_stop_times']
          : t.columns,
  })),
  { table: 'route_stops', columns: ROUTE_STOPS_COLUMNS },
  { table: 'route_branches', columns: ROUTE_BRANCHES_COLUMNS },
];

const stage = (table: string) => `stage_${table}`;

/** Throws unless the feed has every required file and some calendar. */
export function checkRequiredFiles(present: ReadonlySet<string>): void {
  const missing = REQUIRED_FILES.filter((f) => !present.has(f));
  if (!CALENDAR_FILES.some((f) => present.has(f))) missing.push(CALENDAR_FILES.join(' or '));
  if (missing.length > 0) throw new Error(`GTFS feed is missing ${missing.join(', ')}`);
}

/**
 * Throws if a core table came out empty or below MIN_ROW_RATIO of what is
 * loaded now (a truncated or wrong feed), or if there is no calendar at all.
 */
export function checkRowCounts(
  staged: Readonly<Record<string, number>>,
  live: Readonly<Record<string, number>>,
): void {
  const problems: string[] = [];
  for (const table of CORE_TABLES) {
    const next = staged[table] ?? 0;
    const prev = live[table] ?? 0;
    if (next === 0) problems.push(`${table} is empty`);
    else if (prev > 0 && next < prev * MIN_ROW_RATIO) {
      problems.push(`${table} dropped from ${prev} to ${next} rows`);
    }
  }
  if ((staged['service_calendars'] ?? 0) + (staged['service_calendar_dates'] ?? 0) === 0) {
    problems.push('no service calendar rows');
  }
  if (problems.length > 0) throw new Error(`Refusing to load GTFS: ${problems.join('; ')}`);
}

/**
 * Loads an agency's static GTFS so readers never see a partial or doubled
 * data set:
 *
 * 1. Download (timeout and size cap) and extract only the known files.
 * 2. COPY each file into a session-private TEMP staging table on one pinned
 *    connection, validating and escaping every field.
 * 3. Build route_stops, route_branches, has_stop_times and colocated groups
 *    from the staging tables, and check row counts against the live data.
 * 4. In one transaction, replace the agency's rows in every table with the
 *    staged ones and bump agencies.data_version.
 *
 * Any failure before the commit leaves the live data untouched. Temp tables
 * are dropped at the end and are private to the session, and a per-agency
 * advisory lock makes a second, concurrent load of the same agency skip, so
 * two loads can't interleave their swaps.
 */
@Injectable()
export class GtfsStaticService {
  private readonly logger = new Logger(GtfsStaticService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async ingestAgency(agency: ResolvedAgency): Promise<void> {
    this.logger.log(`Starting static GTFS ingestion for agency: ${agency.key}`);
    const startedAt = Date.now();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `gtfs-${agency.key}-`));
    try {
      const zipPath = path.join(tempDir, 'gtfs.zip');
      await this.downloadFile(agency.gtfsStaticUrl, zipPath, agencyAuthHeaders(agency));
      const wanted = [
        ...new Set([...REQUIRED_FILES, ...CALENDAR_FILES, ...STAGED_TABLES.map((t) => t.file)]),
      ];
      const present = await extractGtfsFiles(zipPath, tempDir, wanted);
      fs.rmSync(zipPath);
      checkRequiredFiles(present);

      const agencyId = await this.upsertAgency(agency);

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      // One load per agency at a time, across processes. Two swaps of the same
      // agency could otherwise interleave and leave a mix of both feeds.
      const lockKey = `gtfs-static:${agencyId}`;
      const [{ locked }] = (await queryRunner.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
        [lockKey],
      )) as Array<{ locked: boolean }>;
      if (!locked) {
        await queryRunner.release();
        this.logger.warn(
          `Skipping static ingestion for ${agency.key}: another load of it is in progress`,
        );
        return;
      }
      try {
        await this.createStagingTables(queryRunner);

        const staged: Record<string, number> = {};
        for (const spec of STAGED_TABLES) {
          staged[spec.table] = present.has(spec.file)
            ? await this.copyIntoStage(queryRunner, spec, path.join(tempDir, spec.file), agencyId)
            : 0;
        }

        await this.buildDerivedTables(queryRunner, agencyId);
        const live = await this.liveCounts(queryRunner, agencyId);
        this.logger.log(
          `Staged for ${agency.key}: ${CORE_TABLES.map((t) => `${t} ${live[t] ?? 0} -> ${staged[t]}`).join(', ')}`,
        );
        checkRowCounts(staged, live);

        await this.swapIn(queryRunner, agencyId);
      } finally {
        await this.dropStagingTables(queryRunner).catch((err: unknown) =>
          this.logger.warn(`Failed to drop staging tables: ${(err as Error).message}`),
        );
        // Session-level lock: release it before the connection goes back to the pool.
        await queryRunner
          .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey])
          .catch((err: unknown) =>
            this.logger.warn(`Failed to release load lock: ${(err as Error).message}`),
          );
        await queryRunner.release();
      }

      await Promise.all(
        SWAPPED_TABLES.map(({ table }) => this.dataSource.query(`ANALYZE ${table}`)),
      );
      this.logger.log(
        `Static ingestion completed for agency: ${agency.key} in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Static ingestion failed for agency ${agency.key}; live data unchanged: ${(err as Error).message}`,
      );
      throw err;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async downloadFile(
    url: string,
    dest: string,
    headers: Record<string, string>,
  ): Promise<void> {
    // The signal also aborts a body that stalls part way through.
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(STATIC_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > STATIC_DOWNLOAD_MAX_BYTES) {
      throw new Error(`Download too large: ${declared} bytes (limit ${STATIC_DOWNLOAD_MAX_BYTES})`);
    }
    if (!response.body) throw new Error('Download failed: empty body');
    await pipeline(
      Readable.fromWeb(response.body as import('stream/web').ReadableStream),
      byteLimit(STATIC_DOWNLOAD_MAX_BYTES),
      fs.createWriteStream(dest),
    );
  }

  private async upsertAgency(agency: ResolvedAgency): Promise<string> {
    const [row] = await this.dataSource.query<Array<{ agencyId: string }>>(
      `INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url, gtfs_realtime_url, api_key_env_var)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agency_key) DO UPDATE SET agency_key = EXCLUDED.agency_key
       RETURNING "agencyId"`,
      [
        agency.key,
        agency.displayName,
        agency.timezone,
        agency.gtfsStaticUrl,
        agency.gtfsRealtimeVehiclePositionsUrl ?? null,
        agency.apiKeyEnvVar ?? null,
      ],
    );
    return row.agencyId;
  }

  private async createStagingTables(queryRunner: QueryRunner): Promise<void> {
    await this.dropStagingTables(queryRunner);
    for (const { table } of SWAPPED_TABLES) {
      await queryRunner.query(
        `CREATE TEMP TABLE ${stage(table)} (LIKE ${table} INCLUDING DEFAULTS)`,
      );
    }
  }

  private async dropStagingTables(queryRunner: QueryRunner): Promise<void> {
    const names = SWAPPED_TABLES.map(({ table }) => `pg_temp.${stage(table)}`).join(', ');
    await queryRunner.query(`DROP TABLE IF EXISTS ${names}`);
  }

  /** Streams a GTFS file into its staging table; returns the rows loaded. */
  private async copyIntoStage(
    queryRunner: QueryRunner,
    spec: TableSpec,
    filePath: string,
    agencyId: string,
  ): Promise<number> {
    // The query runner's own connection, so the COPY sees its temp tables.
    const client = (queryRunner as unknown as { databaseConnection: PoolClient })
      .databaseConnection;
    const copy = client.query(
      copyFrom(
        `COPY ${stage(spec.table)} (${spec.columns.join(', ')}) FROM STDIN WITH (FORMAT csv, NULL '')`,
      ),
    );

    let loaded = 0;
    let dropped = 0;
    async function* lines(): AsyncGenerator<string> {
      const rows = fs
        .createReadStream(filePath)
        .pipe(csvParser({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }));
      let chunk: string[] = [];
      for await (const row of rows) {
        const values = spec.toRow(row as Record<string, string>, agencyId);
        if (!values) {
          dropped++;
          continue;
        }
        loaded++;
        chunk.push(copyLine(values));
        if (chunk.length >= COPY_CHUNK_ROWS) {
          yield chunk.join('');
          chunk = [];
        }
      }
      if (chunk.length > 0) yield chunk.join('');
    }

    const started = Date.now();
    await pipeline(Readable.from(lines()), copy);
    this.logger.log(
      `Staged ${loaded} ${spec.table} rows in ${((Date.now() - started) / 1000).toFixed(1)}s` +
        (dropped > 0 ? `; dropped ${dropped} invalid rows` : ''),
    );
    return loaded;
  }

  /** route_stops, route_branches, routes.has_stop_times and stop groups, from staging. */
  private async buildDerivedTables(queryRunner: QueryRunner, agencyId: string): Promise<void> {
    // Temp tables are never auto-analyzed; the joins below need real row counts.
    for (const spec of STAGED_TABLES) await queryRunner.query(`ANALYZE ${stage(spec.table)}`);

    // Every stop (and its parent station) mapped to the routes serving it.
    await queryRunner.query(
      `INSERT INTO stage_route_stops (${ROUTE_STOPS_COLUMNS.join(', ')})
       SELECT $1::uuid, x.stop_id, r.route_id, r.short_name, r.long_name, r.route_type
       FROM (
         SELECT DISTINCT st.stop_id, t.route_id
         FROM stage_stop_times st JOIN stage_trips t ON t.trip_id = st.trip_id
         UNION
         SELECT DISTINCT s.parent_station_id, t.route_id
         FROM stage_stop_times st
         JOIN stage_stops s ON s.stop_id = st.stop_id
         JOIN stage_trips t ON t.trip_id = st.trip_id
         WHERE s.parent_station_id IS NOT NULL AND s.parent_station_id <> ''
       ) x
       JOIN stage_routes r ON r.route_id = x.route_id`,
      [agencyId],
    );

    // A representative trip per (route, direction, headsign), ignoring short
    // turns: at least half the route's longest trip. Ties go to the lowest trip_id,
    // so the chosen trip (and its shape) is stable from one load to the next.
    await queryRunner.query(
      `WITH trip_len AS (
         SELECT t.route_id, t.direction_id, t.trip_headsign, t.trip_id, t.shape_id,
                COUNT(*)::int AS stop_count
         FROM stage_trips t JOIN stage_stop_times st ON st.trip_id = t.trip_id
         GROUP BY t.route_id, t.direction_id, t.trip_headsign, t.trip_id, t.shape_id
       ),
       route_max AS (SELECT route_id, MAX(stop_count) AS max_stops FROM trip_len GROUP BY route_id)
       INSERT INTO stage_route_branches (${ROUTE_BRANCHES_COLUMNS.join(', ')})
       SELECT DISTINCT ON (tl.route_id, tl.direction_id, tl.trip_headsign)
              $1::uuid, tl.route_id, tl.direction_id, tl.trip_headsign, tl.trip_id, tl.shape_id,
              tl.stop_count
       FROM trip_len tl JOIN route_max rm ON rm.route_id = tl.route_id
       WHERE tl.stop_count >= rm.max_stops * 0.5
       ORDER BY tl.route_id, tl.direction_id, tl.trip_headsign, tl.stop_count DESC, tl.trip_id`,
      [agencyId],
    );

    await queryRunner.query(
      `UPDATE stage_routes SET has_stop_times = true
       WHERE route_id IN (
         SELECT t.route_id FROM stage_trips t JOIN stage_stop_times st ON st.trip_id = t.trip_id
       )`,
    );

    const stops = (await queryRunner.query(
      `SELECT stop_id, stop_name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
       FROM stage_stops WHERE parent_station_id IS NULL OR parent_station_id = ''`,
    )) as Array<{ stop_id: string; stop_name: string; lat: number; lon: number }>;
    const routeRows = (await queryRunner.query(
      `SELECT stop_id, route_id FROM stage_route_stops`,
    )) as Array<{ stop_id: string; route_id: string }>;
    const routesByStop = new Map<string, Set<string>>();
    for (const r of routeRows) {
      if (!routesByStop.has(r.stop_id)) routesByStop.set(r.stop_id, new Set());
      routesByStop.get(r.stop_id)!.add(r.route_id);
    }
    const groups = colocatedGroups(
      stops.map((s) => ({ stopId: s.stop_id, stopName: s.stop_name, lat: s.lat, lon: s.lon })),
      routesByStop,
    );
    if (groups.size > 0) {
      await queryRunner.query(
        `UPDATE stage_stops s SET colocated_group_id = v.gid
         FROM unnest($1::text[], $2::text[]) AS v(stop_id, gid)
         WHERE s.stop_id = v.stop_id`,
        [[...groups.keys()], [...groups.values()]],
      );
    }
    this.logger.log(
      `Colocated groups computed: ${new Set(groups.values()).size} groups from ${stops.length} stops`,
    );
  }

  private async liveCounts(
    queryRunner: QueryRunner,
    agencyId: string,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of CORE_TABLES) {
      const [row] = (await queryRunner.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE agency_id = $1`,
        [agencyId],
      )) as Array<{ n: number }>;
      counts[table] = row.n;
    }
    return counts;
  }

  /** Replaces the agency's rows in every table with the staged ones, atomically. */
  private async swapIn(queryRunner: QueryRunner, agencyId: string): Promise<void> {
    const started = Date.now();
    await queryRunner.startTransaction();
    try {
      for (const { table, columns } of SWAPPED_TABLES) {
        await queryRunner.query(`DELETE FROM ${table} WHERE agency_id = $1`, [agencyId]);
        // DO NOTHING drops rows the feed repeats (same unique key).
        await queryRunner.query(
          `INSERT INTO ${table} (${columns.join(', ')})
           SELECT ${columns.join(', ')} FROM ${stage(table)}
           ON CONFLICT DO NOTHING`,
        );
      }
      await queryRunner.query(
        `UPDATE agencies SET last_ingested_at = NOW(), data_version = data_version + 1
         WHERE "agencyId" = $1`,
        [agencyId],
      );
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    }
    this.logger.log(`Swapped in new GTFS data in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}
