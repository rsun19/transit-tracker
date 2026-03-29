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
import { AgenciesService, ResolvedAgency } from '../agencies/agencies.service.js';

// GTFS time strings may exceed 23:59:59 (e.g. "25:30:00" for post-midnight trips)
// Convert to PostgreSQL INTERVAL string
function gtfsTimeToInterval(gtfsTime: string): string | null {
  if (!gtfsTime) return null;
  const parts = gtfsTime.trim().split(':');
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
  return `${h} hours ${m} minutes ${s} seconds`;
}

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
    const zipPath = await this.downloadZip(agencyConfig);

    // 2. Extract ZIP to a temp directory
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), `gtfs-${agencyConfig.key}-`));
    try {
      await this.extractZip(zipPath, extractDir);

      // 3. Parse small CSV files into memory; stream large ones during transaction
      const [routes, stops, trips, calendars] = await Promise.all([
        this.parseCsv(path.join(extractDir, 'routes.txt')),
        this.parseCsv(path.join(extractDir, 'stops.txt')),
        this.parseCsv(path.join(extractDir, 'trips.txt')),
        this.parseCsv(path.join(extractDir, 'calendar.txt')),
      ]);

      // 4. Atomic re-ingestion — shapes.txt (~21MB) and stop_times.txt (~196MB) are streamed
      await this.atomicReingest(agencyConfig, {
        routes, stops, trips, calendars,
        shapesPath: path.join(extractDir, 'shapes.txt'),
        stopTimesPath: path.join(extractDir, 'stop_times.txt'),
      });

      this.logger.log(`Ingestion complete for agency: ${agencyConfig.key}`);
    } finally {
      // Clean up temp files
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
    for await (const row of fs.createReadStream(filePath).pipe(csvParser()) as AsyncIterable<Record<string, string>>) {
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

    const BATCH = 500;
    const STOP_TIMES_BATCH = 50; // smaller batch to limit V8 per-batch allocation on low-memory hosts

    // 3. Insert routes — 7 params per row
    const routes = data.routes;
    (data as { routes: unknown }).routes = [];
    for (let i = 0; i < routes.length; i += BATCH) {
      const batch = routes.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 7;
        values.push(agencyId, row['route_id'], row['route_short_name'] ?? null, row['route_long_name'] ?? null, parseInt(row['route_type'] ?? '3', 10), row['route_color'] ?? null, row['route_text_color'] ?? null);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      });
      await q(`INSERT INTO routes (agency_id,route_id,short_name,long_name,route_type,color,text_color) VALUES ${rows.join(',')}`, values);
    }

    // 4. Insert stops — 8 params per row (lat=$5, lon=$6 → MakePoint(lon,lat))
    const stops = data.stops;
    (data as { stops: unknown }).stops = [];
    for (let i = 0; i < stops.length; i += BATCH) {
      const batch = stops.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 8;
        values.push(agencyId, row['stop_id'], row['stop_name'], row['stop_code'] ?? null, parseFloat(row['stop_lat'] ?? '0'), parseFloat(row['stop_lon'] ?? '0'), row['parent_station'] ?? null, row['wheelchair_boarding'] ? parseInt(row['wheelchair_boarding'], 10) : null);
        return `($${b+1},$${b+2},$${b+3},$${b+4},ST_SetSRID(ST_MakePoint($${b+6},$${b+5}),4326),$${b+7},$${b+8})`;
      });
      await q(`INSERT INTO stops (agency_id,stop_id,stop_name,stop_code,location,parent_station_id,wheelchair_boarding) VALUES ${rows.join(',')}`, values);
    }

    // 5. Insert trips — 8 params per row
    const trips = data.trips;
    (data as { trips: unknown }).trips = [];
    for (let i = 0; i < trips.length; i += BATCH) {
      const batch = trips.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 8;
        values.push(agencyId, row['trip_id'], row['route_id'], row['service_id'], row['trip_headsign'] ?? null, row['direction_id'] ? parseInt(row['direction_id'], 10) : null, row['shape_id'] ?? null, row['wheelchair_accessible'] ? parseInt(row['wheelchair_accessible'], 10) : null);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
      });
      await q(`INSERT INTO trips (agency_id,trip_id,route_id,service_id,trip_headsign,direction_id,shape_id,wheelchair_accessible) VALUES ${rows.join(',')}`, values);
    }

    // 6. Stream shapes — 5 params per row (lat=$4, lon=$5 → MakePoint(lon,lat))
    await this.streamInsert(data.shapesPath, BATCH, async (batch) => {
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 5;
        values.push(agencyId, row['shape_id'], parseInt(row['shape_pt_sequence'] ?? '0', 10), parseFloat(row['shape_pt_lat'] ?? '0'), parseFloat(row['shape_pt_lon'] ?? '0'));
        return `($${b+1},$${b+2},$${b+3},ST_SetSRID(ST_MakePoint($${b+5},$${b+4}),4326))`;
      });
      await q(`INSERT INTO shapes (agency_id,shape_id,pt_sequence,location) VALUES ${rows.join(',')}`, values);
    });

    // 7. Stream stop_times — 9 params per row with ::interval casts (small batch to limit V8 heap)
    await this.streamInsert(data.stopTimesPath, STOP_TIMES_BATCH, async (batch) => {
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 9;
        values.push(agencyId, row['trip_id'], row['stop_id'], parseInt(row['stop_sequence'] ?? '0', 10), gtfsTimeToInterval(row['arrival_time'] ?? ''), gtfsTimeToInterval(row['departure_time'] ?? ''), row['stop_headsign'] ?? null, row['pickup_type'] ? parseInt(row['pickup_type'], 10) : null, row['drop_off_type'] ? parseInt(row['drop_off_type'], 10) : null);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::interval,$${b+6}::interval,$${b+7},$${b+8},$${b+9})`;
      });
      await q(`INSERT INTO stop_times (agency_id,trip_id,stop_id,stop_sequence,arrival_time,departure_time,stop_headsign,pickup_type,drop_off_type) VALUES ${rows.join(',')}`, values);
    });

    // 8. Insert service calendars — 11 params per row
    for (let i = 0; i < data.calendars.length; i += BATCH) {
      const batch = data.calendars.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = batch.map((row, idx) => {
        const b = idx * 11;
        values.push(agencyId, row['service_id'], row['monday'] === '1', row['tuesday'] === '1', row['wednesday'] === '1', row['thursday'] === '1', row['friday'] === '1', row['saturday'] === '1', row['sunday'] === '1', row['start_date'], row['end_date']);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`;
      });
      await q(`INSERT INTO service_calendars (agency_id,service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date) VALUES ${rows.join(',')}`, values);
    }

    // 9. Mark ingested
    await q(`UPDATE agencies SET last_ingested_at = NOW() WHERE "agencyId" = $1`, [agencyId]);
  }
}
