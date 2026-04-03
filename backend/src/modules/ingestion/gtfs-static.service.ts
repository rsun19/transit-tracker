import { Injectable, Logger } from '@nestjs/common';
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
    // Use auto-committed individual queries instead of a single SERIALIZABLE transaction.
    // A transaction spanning 1.4M stop_times rows causes PostgreSQL WAL overflow and crashes.
    // Each batch commits immediately, keeping WAL pressure minimal.
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

    // 2. Delete existing data for this agency (child tables first for FK safety)
    await q(`DELETE FROM stop_times WHERE agency_id = $1`, [agencyId]);
    await q(`DELETE FROM trips WHERE agency_id = $1`, [agencyId]);
    await q(`DELETE FROM shapes WHERE agency_id = $1`, [agencyId]);
    await q(`DELETE FROM service_calendars WHERE agency_id = $1`, [agencyId]);
    await q(`DELETE FROM stops WHERE agency_id = $1`, [agencyId]);
    await q(`DELETE FROM routes WHERE agency_id = $1`, [agencyId]);

    // Make large tables UNLOGGED — eliminates WAL writes during bulk insert,
    // preventing checkpoint I/O thrashing that causes OOM kills on low-memory hosts.
    // These tables can be safely re-ingested on crash recovery, so no WAL needed.
    await q(`ALTER TABLE stop_times SET UNLOGGED`).catch(() => {});
    await q(`ALTER TABLE shapes SET UNLOGGED`).catch(() => {});

    // Drop stop_times secondary indexes before the COPY so PostgreSQL doesn't pay
    // per-row B-tree maintenance cost for 1.4M rows. We rebuild them in a single
    // sort-based pass after COPY — typically 3-5x faster than incremental updates.
    this.logger.debug(`Dropping stop_times secondary indexes for bulk-load...`);
    await q(`DROP INDEX IF EXISTS "IDX_90e1b72ddc98b28eb3e6fa82a2"`).catch(() => {});
    await q(`DROP INDEX IF EXISTS "IDX_66ad0335971b1c9ee60116abf2"`).catch(() => {});

    // Drop GIN trigram indexes on stops before INSERT — GIN indexes are expensive to
    // update incrementally (they fan out into many posting list entries per row).
    // Rebuilding them in one pass after all stops are inserted is much faster.
    this.logger.debug(`Dropping stop GIN trigram indexes for bulk-load...`);
    await q(`DROP INDEX IF EXISTS idx_stops_stop_name_trgm`).catch(() => {});
    await q(`DROP INDEX IF EXISTS idx_stops_stop_code_trgm`).catch(() => {});

    const BATCH = 500;
    // 3. Insert routes — 7 params per row
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
        `INSERT INTO routes (agency_id,route_id,short_name,long_name,route_type,color,text_color) VALUES ${rows.join(',')}`,
        values,
      );
    }
    this.logger.log(`✓ Routes inserted: ${routes.length}`);

    // 4. Insert stops — 8 params per row (lat=$5, lon=$6 → MakePoint(lon,lat))
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
        `INSERT INTO stops (agency_id,stop_id,stop_name,stop_code,location,parent_station_id,wheelchair_boarding) VALUES ${rows.join(',')}`,
        values,
      );
    }
    this.logger.log(`✓ Stops inserted: ${stops.length}`);

    // Rebuild GIN trigram indexes now that all stops are inserted — single-pass
    // build is far cheaper than per-row GIN updates during INSERT.
    this.logger.debug(`Rebuilding stop GIN trigram indexes...`);
    await q(`CREATE INDEX idx_stops_stop_name_trgm ON stops USING gin (stop_name gin_trgm_ops)`);
    await q(`CREATE INDEX idx_stops_stop_code_trgm ON stops USING gin (stop_code gin_trgm_ops)`);
    this.logger.log(`✓ Stop GIN trigram indexes rebuilt`);

    // 5. Insert trips — 8 params per row
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
        `INSERT INTO trips (agency_id,trip_id,route_id,service_id,trip_headsign,direction_id,shape_id,wheelchair_accessible) VALUES ${rows.join(',')}`,
        values,
      );
    }
    this.logger.log(`✓ Trips inserted: ${trips.length}`);

    // 6. Stream shapes via COPY FROM STDIN — constant memory regardless of table size
    this.logger.debug(`Streaming shapes via COPY FROM STDIN...`);
    await this.copyShapes(data.shapesPath, agencyId);
    this.logger.log(`✓ Shapes inserted (via COPY)`);

    // 7. Stream stop_times via COPY FROM STDIN — avoids OOM from large INSERT parse trees
    this.logger.debug(`Streaming stop_times via COPY FROM STDIN (this will take 5-10 minutes)...`);
    await this.copyStopTimes(data.stopTimesPath, agencyId);
    this.logger.log(`✓ Stop times inserted (via COPY)`);

    // Rebuild stop_times secondary indexes in a single sort-based pass.
    // Higher maintenance_work_mem allows PostgreSQL to sort in memory instead of
    // spilling to disk, making index builds significantly faster.
    this.logger.debug(`Rebuilding stop_times indexes (single-pass sort-based build)...`);
    await q(`SET maintenance_work_mem = '256MB'`);
    await q(
      `CREATE INDEX "IDX_90e1b72ddc98b28eb3e6fa82a2" ON stop_times (agency_id, stop_id, departure_time)`,
    );
    await q(
      `CREATE INDEX "IDX_66ad0335971b1c9ee60116abf2" ON stop_times (agency_id, trip_id, stop_sequence)`,
    );
    await q(`RESET maintenance_work_mem`);
    this.logger.log(`✓ stop_times indexes rebuilt`);

    // CLUSTER physically reorders the stop_times heap to match the (agency_id, stop_id)
    // index. This converts per-stop queries from random I/O across the heap into
    // sequential page reads — critical for high-frequency stops with thousands of
    // stop_times rows scattered across many pages.
    this.logger.debug(`Clustering stop_times on stop_id index (may take ~2 minutes)...`);
    await q(`CLUSTER stop_times USING "IDX_90e1b72ddc98b28eb3e6fa82a2"`);
    this.logger.log(`✓ stop_times clustered`);

    // Prune stops that have no stop_times and are not referenced as a parent station.
    // GTFS parent-station stops (location_type=1) have no stop_times of their own but
    // must be retained so child-stop grouping works. All other unreferenced stops are
    // dead weight that inflate search results and waste memory.
    this.logger.debug(`Pruning orphan stops (no stop_times, not a parent station)...`);
    const pruneResult = await q<Array<{ count: string }>>(
      `WITH deleted AS (
         DELETE FROM stops
         WHERE agency_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM stop_times st
             WHERE st.stop_id = stops.stop_id AND st.agency_id = stops.agency_id
           )
           AND stop_id NOT IN (
             SELECT DISTINCT parent_station_id FROM stops
             WHERE agency_id = $1 AND parent_station_id IS NOT NULL
           )
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
      [agencyId],
    );
    this.logger.log(`✓ Orphan stops pruned: ${pruneResult[0]?.count ?? 0}`);

    // 8. Insert service calendars — 11 params per row
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
        `INSERT INTO service_calendars (agency_id,service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date) VALUES ${rows.join(',')}`,
        values,
      );
    }
    this.logger.log(`✓ Service calendars inserted: ${data.calendars.length}`);

    // 9. Refresh planner statistics for all ingested tables so the query planner
    // uses accurate row count and histogram estimates on the freshly loaded data.
    this.logger.debug(`Analyzing ingested tables...`);
    await Promise.all([
      q(`ANALYZE stop_times`),
      q(`ANALYZE trips`),
      q(`ANALYZE stops`),
      q(`ANALYZE routes`),
      q(`ANALYZE service_calendars`),
    ]);
    this.logger.log(`✓ Table statistics refreshed`);

    // 10. Mark ingested
    this.logger.debug(`Marking agency as ingested...`);
    await q(`UPDATE agencies SET last_ingested_at = NOW() WHERE "agencyId" = $1`, [agencyId]);
    this.logger.log(`✓ Agency marked as ingested`);
  }

  // --- COPY FROM STDIN helpers (used for large tables to avoid OOM) --------

  private async copyShapes(filePath: string, agencyId: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgPool: Pool = (this.dataSource.driver as unknown as { master: Pool }).master;
    const pgClient: PoolClient = await pgPool.connect();
    try {
      let shapeRowCount = 0;
      await new Promise<void>((resolve, reject) => {
        const copyStream = pgClient.query(
          copyFrom(
            `COPY shapes (agency_id,shape_id,pt_sequence,location) FROM STDIN WITH (FORMAT csv, NULL '')`,
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

  private async copyStopTimes(filePath: string, agencyId: string): Promise<void> {
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
            `COPY stop_times (agency_id,trip_id,stop_id,stop_sequence,arrival_time,departure_time,stop_headsign,pickup_type,drop_off_type) FROM STDIN WITH (FORMAT csv, NULL '')`,
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
