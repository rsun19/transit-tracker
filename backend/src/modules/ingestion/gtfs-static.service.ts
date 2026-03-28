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

      // 3. Parse all CSV files
      const [routes, stops, trips, stopTimes, shapes, calendars] = await Promise.all([
        this.parseCsv(path.join(extractDir, 'routes.txt')),
        this.parseCsv(path.join(extractDir, 'stops.txt')),
        this.parseCsv(path.join(extractDir, 'trips.txt')),
        this.parseCsv(path.join(extractDir, 'stop_times.txt')),
        this.parseCsvOptional(path.join(extractDir, 'shapes.txt')),
        this.parseCsv(path.join(extractDir, 'calendar.txt')),
      ]);

      // Also parse calendar_dates.txt if present (AN-18 fix)
      const calendarDates = await this.parseCsvOptional(path.join(extractDir, 'calendar_dates.txt'));

      // 4. Atomic re-ingestion within a SERIALIZABLE transaction
      await this.atomicReingest(agencyConfig, { routes, stops, trips, stopTimes, shapes, calendars, calendarDates });

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

  private async atomicReingest(
    agencyConfig: ResolvedAgency,
    data: {
      routes: Record<string, string>[];
      stops: Record<string, string>[];
      trips: Record<string, string>[];
      stopTimes: Record<string, string>[];
      shapes: Record<string, string>[];
      calendars: Record<string, string>[];
      calendarDates: Record<string, string>[];
    },
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      // Upsert agency record
      const agencyResult = await queryRunner.query(
        `INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url, gtfs_realtime_url, api_key_env_var)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agency_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           timezone = EXCLUDED.timezone,
           gtfs_static_url = EXCLUDED.gtfs_static_url,
           gtfs_realtime_url = EXCLUDED.gtfs_realtime_url,
           api_key_env_var = EXCLUDED.api_key_env_var
         RETURNING agency_id`,
        [
          agencyConfig.key,
          agencyConfig.displayName,
          agencyConfig.timezone,
          agencyConfig.gtfsStaticUrl,
          agencyConfig.gtfsRealtimeUrl ?? null,
          agencyConfig.apiKeyEnvVar ?? null,
        ],
      );

      const agencyId: string = (agencyResult as Array<{ agency_id: string }>)[0].agency_id;

      // Delete existing data for this agency (atomic re-ingestion — FR-019)
      await queryRunner.query(`DELETE FROM stop_times WHERE agency_id = $1`, [agencyId]);
      await queryRunner.query(`DELETE FROM trips WHERE agency_id = $1`, [agencyId]);
      await queryRunner.query(`DELETE FROM shapes WHERE agency_id = $1`, [agencyId]);
      await queryRunner.query(`DELETE FROM service_calendars WHERE agency_id = $1`, [agencyId]);
      await queryRunner.query(`DELETE FROM stops WHERE agency_id = $1`, [agencyId]);
      await queryRunner.query(`DELETE FROM routes WHERE agency_id = $1`, [agencyId]);

      // Insert routes
      for (const row of data.routes) {
        await queryRunner.query(
          `INSERT INTO routes (agency_id, route_id, short_name, long_name, route_type, color, text_color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            agencyId,
            row['route_id'],
            row['route_short_name'] ?? null,
            row['route_long_name'] ?? null,
            parseInt(row['route_type'] ?? '3', 10),
            row['route_color'] ?? null,
            row['route_text_color'] ?? null,
          ],
        );
      }

      // Insert stops
      for (const row of data.stops) {
        const lat = parseFloat(row['stop_lat'] ?? '0');
        const lon = parseFloat(row['stop_lon'] ?? '0');
        await queryRunner.query(
          `INSERT INTO stops (agency_id, stop_id, stop_name, stop_code, location, parent_station_id, wheelchair_boarding)
           VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326), $7, $8)`,
          [
            agencyId,
            row['stop_id'],
            row['stop_name'],
            row['stop_code'] ?? null,
            lat,
            lon,
            row['parent_station'] ?? null,
            row['wheelchair_boarding'] ? parseInt(row['wheelchair_boarding'], 10) : null,
          ],
        );
      }

      // Insert trips
      for (const row of data.trips) {
        await queryRunner.query(
          `INSERT INTO trips (agency_id, trip_id, route_id, service_id, trip_headsign, direction_id, shape_id, wheelchair_accessible)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            agencyId,
            row['trip_id'],
            row['route_id'],
            row['service_id'],
            row['trip_headsign'] ?? null,
            row['direction_id'] ? parseInt(row['direction_id'], 10) : null,
            row['shape_id'] ?? null,
            row['wheelchair_accessible'] ? parseInt(row['wheelchair_accessible'], 10) : null,
          ],
        );
      }

      // Insert stop_times in batches of 1000
      const BATCH = 1000;
      for (let i = 0; i < data.stopTimes.length; i += BATCH) {
        const batch = data.stopTimes.slice(i, i + BATCH);
        for (const row of batch) {
          await queryRunner.query(
            `INSERT INTO stop_times (agency_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time, stop_headsign, pickup_type, drop_off_type)
             VALUES ($1, $2, $3, $4, $5::interval, $6::interval, $7, $8, $9)`,
            [
              agencyId,
              row['trip_id'],
              row['stop_id'],
              parseInt(row['stop_sequence'] ?? '0', 10),
              gtfsTimeToInterval(row['arrival_time'] ?? ''),
              gtfsTimeToInterval(row['departure_time'] ?? ''),
              row['stop_headsign'] ?? null,
              row['pickup_type'] ? parseInt(row['pickup_type'], 10) : null,
              row['drop_off_type'] ? parseInt(row['drop_off_type'], 10) : null,
            ],
          );
        }
      }

      // Insert shapes
      for (const row of data.shapes) {
        const lat = parseFloat(row['shape_pt_lat'] ?? '0');
        const lon = parseFloat(row['shape_pt_lon'] ?? '0');
        await queryRunner.query(
          `INSERT INTO shapes (agency_id, shape_id, pt_sequence, location)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326))`,
          [
            agencyId,
            row['shape_id'],
            parseInt(row['shape_pt_sequence'] ?? '0', 10),
            lat,
            lon,
          ],
        );
      }

      // Insert service calendars
      for (const row of data.calendars) {
        await queryRunner.query(
          `INSERT INTO service_calendars (agency_id, service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
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
          ],
        );
      }

      // Update last_ingested_at
      await queryRunner.query(
        `UPDATE agencies SET last_ingested_at = NOW() WHERE agency_id = $1`,
        [agencyId],
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
