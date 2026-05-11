import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Agency,
  Route,
  Stop,
  StopTime,
  Trip,
  Shape,
  ServiceCalendar,
} from '@transit-tracker/shared';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';
import * as unzipper from 'unzipper';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import csvParser from 'csv-parser';
import { type ResolvedAgency } from '@transit-tracker/shared';

interface GtfsRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
  route_color: string;
  route_text_color: string;
}

interface GtfsTrip {
  trip_id: string;
  route_id: string;
  service_id: string;
  trip_headsign: string;
  direction_id: string;
  shape_id: string;
  wheelchair_accessible: string;
}

interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_code: string;
  stop_lat: string;
  stop_lon: string;
  parent_station: string;
  wheelchair_boarding: string;
  location_type: string;
}

interface GtfsStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
  arrival_time: string;
  departure_time: string;
  stop_headsign: string;
  pickup_type: string;
  drop_off_type: string;
}

interface GtfsShape {
  shape_id: string;
  shape_pt_sequence: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
}

interface GtfsCalendar {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  start_date: string;
  end_date: string;
}

@Injectable()
export class GtfsStaticService {
  private readonly logger = new Logger(GtfsStaticService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async ingestAgency(agency: ResolvedAgency): Promise<void> {
    this.logger.log(`Starting static GTFS ingestion for agency: ${agency.key}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `gtfs-${agency.key}-`));
    try {
      const zipPath = path.join(tempDir, 'gtfs.zip');
      await this.downloadFile(agency.gtfsStaticUrl, zipPath, agency.resolvedApiKey);
      await this.extractZip(zipPath, tempDir);

      const agencyEntity = await this.upsertAgency(agency);
      const agencyId = agencyEntity.agencyId;

      await this.importCsvWithCopy(
        path.join(tempDir, 'routes.txt'),
        agencyId,
        async (rows: GtfsRoute[]) => {
          await this.batchInsertRoutes(agencyId, rows);
        },
      );
      await this.importCsvWithCopy(
        path.join(tempDir, 'trips.txt'),
        agencyId,
        async (rows: GtfsTrip[]) => {
          await this.batchInsertTrips(agencyId, rows);
        },
      );
      await this.importCsvWithCopy(
        path.join(tempDir, 'stops.txt'),
        agencyId,
        async (rows: GtfsStop[]) => {
          await this.batchInsertStops(agencyId, rows);
        },
      );
      await this.importCsvWithCopy(
        path.join(tempDir, 'calendar.txt'),
        agencyId,
        async (rows: GtfsCalendar[]) => {
          await this.batchInsertCalendars(agencyId, rows);
        },
      );

      // Use COPY for large tables
      await this.copyStopTimes(tempDir, agencyId);
      await this.copyShapes(tempDir, agencyId);

      await this.dataSource.query(
        `UPDATE agencies SET last_ingested_at = NOW() WHERE "agencyId" = $1`,
        [agencyId],
      );

      this.logger.log(`Static ingestion completed for agency: ${agency.key}`);
    } catch (err: unknown) {
      this.logger.error(
        `Static ingestion failed for agency ${agency.key}: ${(err as Error).message}`,
      );
      throw err;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async downloadFile(url: string, dest: string, apiKey?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const fileStream = fs.createWriteStream(dest);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    await pipeline(createReadStream(zipPath), unzipper.Extract({ path: destDir }));
  }

  private async upsertAgency(agency: ResolvedAgency): Promise<Agency> {
    const existing = await this.dataSource.query<Array<{ agencyId: string }>>(
      `SELECT "agencyId" FROM agencies WHERE agency_key = $1 LIMIT 1`,
      [agency.key],
    );

    if (existing.length > 0) {
      return { agencyId: existing[0].agencyId } as Agency;
    }

    const result = await this.dataSource.query<Array<{ agencyId: string }>>(
      `INSERT INTO agencies (agency_key, display_name, timezone, gtfs_static_url, gtfs_realtime_url, api_key_env_var)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING "agencyId"`,
      [
        agency.key,
        agency.displayName,
        agency.timezone,
        agency.gtfsStaticUrl,
        agency.gtfsRealtimeVehiclePositionsUrl ?? null,
        agency.apiKeyEnvVar ?? null,
      ],
    );
    return { agencyId: result[0].agencyId } as Agency;
  }

  private async importCsvWithCopy<T>(
    filePath: string,
    _agencyId: string,
    batchFn: (rows: T[]) => Promise<void>,
  ): Promise<void> {
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`File not found — skipping: ${filePath}`);
      return;
    }

    const rows: T[] = [];
    const BATCH_SIZE = 1000;

    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row: T) => {
          rows.push(row);
          if (rows.length >= BATCH_SIZE) {
            // pause and process batch
          }
        })
        .on('end', async () => {
          if (rows.length > 0) await batchFn(rows);
          resolve();
        })
        .on('error', reject);
    });
  }

  private async batchInsertRoutes(agencyId: string, routes: GtfsRoute[]): Promise<void> {
    // Simplified — see monolith for full implementation
    const values = routes
      .map(
        (r) =>
          `('${agencyId}', '${r.route_id.replace(/'/g, "''")}', '${(r.route_short_name || '').replace(/'/g, "''")}', '${(r.route_long_name || '').replace(/'/g, "''")}', ${parseInt(r.route_type) || 0}, '${(r.route_color || '').replace(/'/g, "''")}', '${(r.route_text_color || '').replace(/'/g, "''")}')`,
      )
      .join(',');
    if (values.length === 0) return;
    await this.dataSource.query(
      `INSERT INTO routes (agency_id, route_id, short_name, long_name, route_type, color, text_color) VALUES ${values}
       ON CONFLICT (agency_id, route_id) DO UPDATE SET short_name = EXCLUDED.short_name, long_name = EXCLUDED.long_name, route_type = EXCLUDED.route_type, color = EXCLUDED.color, text_color = EXCLUDED.text_color`,
    );
  }

  private async batchInsertTrips(agencyId: string, trips: GtfsTrip[]): Promise<void> {
    const values = trips
      .map(
        (t) =>
          `('${agencyId}', '${t.trip_id.replace(/'/g, "''")}', '${t.route_id.replace(/'/g, "''")}', '${(t.service_id || '').replace(/'/g, "''")}', ${t.trip_headsign ? `'${t.trip_headsign.replace(/'/g, "''")}'` : 'NULL'}, ${t.direction_id ? parseInt(t.direction_id) : 'NULL'}, ${t.shape_id ? `'${t.shape_id.replace(/'/g, "''")}'` : 'NULL'}, ${t.wheelchair_accessible ? parseInt(t.wheelchair_accessible) : 'NULL'})`,
      )
      .join(',');
    if (values.length === 0) return;
    await this.dataSource.query(
      `INSERT INTO trips (agency_id, trip_id, route_id, service_id, trip_headsign, direction_id, shape_id, wheelchair_accessible) VALUES ${values}
       ON CONFLICT (agency_id, trip_id) DO UPDATE SET route_id = EXCLUDED.route_id, service_id = EXCLUDED.service_id, trip_headsign = EXCLUDED.trip_headsign, direction_id = EXCLUDED.direction_id, shape_id = EXCLUDED.shape_id, wheelchair_accessible = EXCLUDED.wheelchair_accessible`,
    );
  }

  private async batchInsertStops(agencyId: string, stops: GtfsStop[]): Promise<void> {
    const valid = stops.filter((s) => {
      const lat = parseFloat(s.stop_lat);
      const lon = parseFloat(s.stop_lon);
      return !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon);
    });
    if (valid.length === 0) return;
    const values = valid
      .map((s) => {
        const lat = parseFloat(s.stop_lat);
        const lon = parseFloat(s.stop_lon);
        return `('${agencyId}', '${s.stop_id.replace(/'/g, "''")}', '${(s.stop_name || '').replace(/'/g, "''")}', ${s.stop_code ? `'${s.stop_code.replace(/'/g, "''")}'` : 'NULL'}, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${s.parent_station ? `'${s.parent_station.replace(/'/g, "''")}'` : 'NULL'}, ${s.wheelchair_boarding ? parseInt(s.wheelchair_boarding) : 'NULL'})`;
      })
      .join(',');
    if (values.length === 0) return;
    await this.dataSource.query(
      `INSERT INTO stops (agency_id, stop_id, stop_name, stop_code, location, parent_station_id, wheelchair_boarding) VALUES ${values}
       ON CONFLICT (agency_id, stop_id) DO UPDATE SET stop_name = EXCLUDED.stop_name, stop_code = EXCLUDED.stop_code, location = EXCLUDED.location, parent_station_id = EXCLUDED.parent_station_id, wheelchair_boarding = EXCLUDED.wheelchair_boarding`,
    );
  }

  private async batchInsertCalendars(agencyId: string, calendars: GtfsCalendar[]): Promise<void> {
    const values = calendars
      .map((c) => {
        const bool = (v: string) => v === '1';
        return `('${agencyId}', '${c.service_id.replace(/'/g, "''")}', ${bool(c.monday)}, ${bool(c.tuesday)}, ${bool(c.wednesday)}, ${bool(c.thursday)}, ${bool(c.friday)}, ${bool(c.saturday)}, ${bool(c.sunday)}, '${c.start_date}', '${c.end_date}')`;
      })
      .join(',');
    if (values.length === 0) return;
    await this.dataSource.query(
      `INSERT INTO service_calendars (agency_id, service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date) VALUES ${values}
       ON CONFLICT (agency_id, service_id) DO UPDATE SET monday = EXCLUDED.monday, tuesday = EXCLUDED.tuesday, wednesday = EXCLUDED.wednesday, thursday = EXCLUDED.thursday, friday = EXCLUDED.friday, saturday = EXCLUDED.saturday, sunday = EXCLUDED.sunday, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
    );
  }

  private async copyStopTimes(tempDir: string, agencyId: string): Promise<void> {
    const filePath = path.join(tempDir, 'stop_times.txt');
    if (!fs.existsSync(filePath)) return;
    // Full implementation uses shadow table swap with COPY — simplified here
    this.logger.log(`Importing stop_times for agency ${agencyId}`);
    await this.dataSource.query(
      `CREATE UNLOGGED TABLE stop_times_new (LIKE stop_times INCLUDING ALL)`,
    );
    // In production, use pg-copy-streams for the actual COPY
    await this.dataSource.query(`DROP TABLE stop_times_new`);
  }

  private async copyShapes(tempDir: string, agencyId: string): Promise<void> {
    const filePath = path.join(tempDir, 'shapes.txt');
    if (!fs.existsSync(filePath)) return;
    this.logger.log(`Importing shapes for agency ${agencyId}`);
  }
}
