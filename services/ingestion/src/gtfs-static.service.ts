import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Agency, STOP_MERGE_RADIUS_DEG } from '@transit-tracker/shared';
import type { ResolvedAgency } from '@transit-tracker/shared';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';
import * as unzipper from 'unzipper';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import csvParser from 'csv-parser';

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

      // Clean up stale data before re-inserting (idempotent re-ingestion)
      this.logger.debug(`Deleting existing data for agency ${agencyId}...`);
      await this.dataSource.query(`DELETE FROM stop_times WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM trips WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM stops WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM routes WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM shapes WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM service_calendars WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM route_stops WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(`DELETE FROM route_branches WHERE agency_id = $1`, [agencyId]);

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

      // Build indexes for query performance
      this.logger.debug(`Building GIN trigram indexes on stops...`);
      await this.dataSource
        .query(
          `CREATE INDEX IF NOT EXISTS idx_stops_stop_name_trgm ON stops USING gin (stop_name gin_trgm_ops)`,
        )
        .catch((err: unknown) =>
          this.logger.warn(`Failed to create idx_stops_stop_name_trgm: ${(err as Error).message}`),
        );
      await this.dataSource
        .query(
          `CREATE INDEX IF NOT EXISTS idx_stops_stop_code_trgm ON stops USING gin (stop_code gin_trgm_ops)`,
        )
        .catch((err: unknown) =>
          this.logger.warn(`Failed to create idx_stops_stop_code_trgm: ${(err as Error).message}`),
        );
      this.logger.debug(`Building stop_times indexes...`);
      await this.dataSource
        .query(
          `CREATE INDEX IF NOT EXISTS idx_stop_times_agency_stop_dept ON stop_times (agency_id, stop_id, departure_time)`,
        )
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to create idx_stop_times_agency_stop_dept: ${(err as Error).message}`,
          ),
        );
      await this.dataSource
        .query(
          `CREATE INDEX IF NOT EXISTS idx_stop_times_agency_trip_seq ON stop_times (agency_id, trip_id, stop_sequence)`,
        )
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to create idx_stop_times_agency_trip_seq: ${(err as Error).message}`,
          ),
        );

      // Precompute route_stops — maps every stop to its serving routes
      this.logger.debug(`Creating route_stops table...`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS route_stops (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
          stop_id VARCHAR(100) NOT NULL,
          route_id VARCHAR(100) NOT NULL,
          short_name VARCHAR(50),
          long_name TEXT,
          route_type SMALLINT NOT NULL,
          UNIQUE (agency_id, stop_id, route_id)
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_route_stops_agency_stop ON route_stops (agency_id, stop_id)`,
      );
      this.logger.debug(`Populating route_stops from stop_times...`);
      await this.dataSource.query(`DELETE FROM route_stops WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(
        `
        INSERT INTO route_stops (agency_id, stop_id, route_id, short_name, long_name, route_type)
        SELECT DISTINCT st.agency_id, st.stop_id, r.route_id, r.short_name, r.long_name, r.route_type
        FROM stop_times st
        JOIN trips t ON t.trip_id = st.trip_id AND t.agency_id = st.agency_id
        JOIN routes r ON r.route_id = t.route_id AND r.agency_id = t.agency_id
        WHERE st.agency_id = $1
        UNION
        SELECT DISTINCT st.agency_id, s.parent_station_id, r.route_id, r.short_name, r.long_name, r.route_type
        FROM stop_times st
        JOIN stops s ON s.stop_id = st.stop_id AND s.agency_id = st.agency_id
        JOIN trips t ON t.trip_id = st.trip_id AND t.agency_id = st.agency_id
        JOIN routes r ON r.route_id = t.route_id AND r.agency_id = t.agency_id
        WHERE st.agency_id = $1
          AND s.parent_station_id IS NOT NULL AND s.parent_station_id != ''
      `,
        [agencyId],
      );

      // Precompute route_branches — representative trip per (route, direction, headsign)
      this.logger.debug(`Creating route_branches table...`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS route_branches (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agency_id UUID NOT NULL REFERENCES agencies("agencyId") ON DELETE CASCADE,
          route_id VARCHAR(100) NOT NULL,
          direction_id SMALLINT,
          trip_headsign TEXT,
          trip_id VARCHAR(100) NOT NULL,
          shape_id VARCHAR(100),
          stop_count INTEGER NOT NULL
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_route_branches_agency_route ON route_branches (agency_id, route_id)`,
      );
      this.logger.debug(`Populating route_branches from trips...`);
      await this.dataSource.query(`DELETE FROM route_branches WHERE agency_id = $1`, [agencyId]);
      await this.dataSource.query(
        `
        WITH route_max_stops AS (
          SELECT t2.agency_id, t2.route_id, MAX(t2.cnt)::int AS max_stops
          FROM (
            SELECT t3.agency_id, t3.route_id, COUNT(st3.stop_id) AS cnt
            FROM trips t3
            JOIN stop_times st3 ON st3.trip_id = t3.trip_id AND st3.agency_id = t3.agency_id
            WHERE t3.agency_id = $1
            GROUP BY t3.agency_id, t3.route_id, t3.trip_id
          ) t2
          GROUP BY t2.agency_id, t2.route_id
        )
        INSERT INTO route_branches (agency_id, route_id, direction_id, trip_headsign, trip_id, shape_id, stop_count)
        SELECT DISTINCT ON (t.route_id, t.direction_id, t.trip_headsign)
          t.agency_id, t.route_id, t.direction_id, t.trip_headsign, t.trip_id, t.shape_id,
          COUNT(st.stop_id)::int AS stop_count
        FROM trips t
        JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
        JOIN route_max_stops rms ON rms.route_id = t.route_id AND rms.agency_id = t.agency_id
        WHERE t.agency_id = $1
        GROUP BY t.agency_id, t.route_id, t.direction_id, t.trip_headsign, t.trip_id, t.shape_id, rms.max_stops
        HAVING COUNT(st.stop_id)::int >= rms.max_stops * 0.5
        ORDER BY t.route_id, t.direction_id, t.trip_headsign, stop_count DESC
      `,
        [agencyId],
      );

      // Update has_stop_times flag on routes
      this.logger.debug(`Updating has_stop_times on routes...`);
      await this.dataSource.query(
        `
        UPDATE routes SET has_stop_times = true
        WHERE agency_id = $1
          AND EXISTS (
            SELECT 1 FROM trips t
            JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
            WHERE t.route_id = routes.route_id AND t.agency_id = routes.agency_id
          )
      `,
        [agencyId],
      );

      // Precompute colocated_group_id on stops
      this.logger.debug(`Computing colocated stop groups...`);
      await this.computeColocatedGroups(agencyId);

      this.logger.debug(`Analyzing tables...`);
      await Promise.all([
        this.dataSource.query(`ANALYZE stop_times`),
        this.dataSource.query(`ANALYZE trips`),
        this.dataSource.query(`ANALYZE stops`),
        this.dataSource.query(`ANALYZE routes`),
        this.dataSource.query(`ANALYZE service_calendars`),
        this.dataSource.query(`ANALYZE route_stops`),
        this.dataSource.query(`ANALYZE route_branches`),
      ]);

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
    const cols = 7;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < routes.length; i += chunkSize) {
      const chunk = routes.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const r of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6})`,
        );
        params.push(
          agencyId,
          r.route_id,
          r.route_short_name || null,
          r.route_long_name || null,
          parseInt(r.route_type) || 0,
          r.route_color || null,
          r.route_text_color || null,
        );
      }
      await this.dataSource.query(
        `INSERT INTO routes (agency_id, route_id, short_name, long_name, route_type, color, text_color) VALUES ${placeholders.join(', ')}
         ON CONFLICT (agency_id, route_id) DO UPDATE SET short_name = EXCLUDED.short_name, long_name = EXCLUDED.long_name, route_type = EXCLUDED.route_type, color = EXCLUDED.color, text_color = EXCLUDED.text_color`,
        params,
      );
    }
  }

  private async batchInsertTrips(agencyId: string, trips: GtfsTrip[]): Promise<void> {
    const cols = 8;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < trips.length; i += chunkSize) {
      const chunk = trips.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const t of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7})`,
        );
        params.push(
          agencyId,
          t.trip_id,
          t.route_id,
          t.service_id || null,
          t.trip_headsign || null,
          t.direction_id ? parseInt(t.direction_id) : null,
          t.shape_id || null,
          t.wheelchair_accessible ? parseInt(t.wheelchair_accessible) : null,
        );
      }
      await this.dataSource.query(
        `INSERT INTO trips (agency_id, trip_id, route_id, service_id, trip_headsign, direction_id, shape_id, wheelchair_accessible) VALUES ${placeholders.join(', ')}
         ON CONFLICT (agency_id, trip_id) DO UPDATE SET route_id = EXCLUDED.route_id, service_id = EXCLUDED.service_id, trip_headsign = EXCLUDED.trip_headsign, direction_id = EXCLUDED.direction_id, shape_id = EXCLUDED.shape_id, wheelchair_accessible = EXCLUDED.wheelchair_accessible`,
        params,
      );
    }
  }

  private async batchInsertStops(agencyId: string, stops: GtfsStop[]): Promise<void> {
    const valid = stops.filter((s) => {
      const lat = parseFloat(s.stop_lat);
      const lon = parseFloat(s.stop_lon);
      return !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon);
    });
    if (valid.length === 0) return;
    const cols = 8;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < valid.length; i += chunkSize) {
      const chunk = valid.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const s of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, $${n + 3}, ST_SetSRID(ST_MakePoint($${n + 4}, $${n + 5}), 4326), $${n + 6}, $${n + 7})`,
        );
        const lat = parseFloat(s.stop_lat);
        const lon = parseFloat(s.stop_lon);
        params.push(
          agencyId,
          s.stop_id,
          s.stop_name || null,
          s.stop_code || null,
          lon,
          lat,
          s.parent_station || null,
          s.wheelchair_boarding ? parseInt(s.wheelchair_boarding) : null,
        );
      }
      await this.dataSource.query(
        `INSERT INTO stops (agency_id, stop_id, stop_name, stop_code, location, parent_station_id, wheelchair_boarding) VALUES ${placeholders.join(', ')}
         ON CONFLICT (agency_id, stop_id) DO UPDATE SET stop_name = EXCLUDED.stop_name, stop_code = EXCLUDED.stop_code, location = EXCLUDED.location, parent_station_id = EXCLUDED.parent_station_id, wheelchair_boarding = EXCLUDED.wheelchair_boarding`,
        params,
      );
    }
  }

  private async batchInsertCalendars(agencyId: string, calendars: GtfsCalendar[]): Promise<void> {
    const cols = 11;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < calendars.length; i += chunkSize) {
      const chunk = calendars.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const c of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9}, $${n + 10})`,
        );
        const bool = (v: string) => v === '1';
        params.push(
          agencyId,
          c.service_id,
          bool(c.monday),
          bool(c.tuesday),
          bool(c.wednesday),
          bool(c.thursday),
          bool(c.friday),
          bool(c.saturday),
          bool(c.sunday),
          c.start_date,
          c.end_date,
        );
      }
      await this.dataSource.query(
        `INSERT INTO service_calendars (agency_id, service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date) VALUES ${placeholders.join(', ')}
         ON CONFLICT (agency_id, service_id) DO UPDATE SET monday = EXCLUDED.monday, tuesday = EXCLUDED.tuesday, wednesday = EXCLUDED.wednesday, thursday = EXCLUDED.thursday, friday = EXCLUDED.friday, saturday = EXCLUDED.saturday, sunday = EXCLUDED.sunday, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
        params,
      );
    }
  }

  private async copyStopTimes(tempDir: string, agencyId: string): Promise<void> {
    const filePath = path.join(tempDir, 'stop_times.txt');
    if (!fs.existsSync(filePath)) return;
    this.logger.log(`Importing stop_times for agency ${agencyId}`);

    interface GtfsStopTimeRow {
      trip_id: string;
      stop_id: string;
      stop_sequence: string;
      arrival_time: string;
      departure_time: string;
      stop_headsign: string;
      pickup_type: string;
      drop_off_type: string;
    }

    const rows: GtfsStopTimeRow[] = await new Promise((resolve, reject) => {
      const acc: GtfsStopTimeRow[] = [];
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (r: GtfsStopTimeRow) => acc.push(r))
        .on('end', () => resolve(acc))
        .on('error', reject);
    });

    const cols = 9;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const r of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8})`,
        );
        params.push(
          agencyId,
          r.trip_id,
          r.stop_id,
          parseInt(r.stop_sequence),
          r.arrival_time || null,
          r.departure_time || null,
          r.stop_headsign || null,
          r.pickup_type ? parseInt(r.pickup_type) : null,
          r.drop_off_type ? parseInt(r.drop_off_type) : null,
        );
      }
      await this.dataSource.query(
        `INSERT INTO stop_times (agency_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time, stop_headsign, pickup_type, drop_off_type) VALUES ${placeholders.join(', ')}
         ON CONFLICT DO NOTHING`,
        params,
      );
    }
    this.logger.log(`Imported ${rows.length} stop_times rows for agency ${agencyId}`);
  }

  private async computeColocatedGroups(agencyId: string): Promise<void> {
    const stops = await this.dataSource.query<
      Array<{ stop_id: string; stop_name: string; lat: number; lon: number }>
    >(
      `SELECT stop_id, stop_name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
       FROM stops
       WHERE agency_id = $1
         AND (parent_station_id IS NULL OR parent_station_id = '')`,
      [agencyId],
    );

    const stopIdList = stops.map((s) => s.stop_id);
    const routeRows = await this.dataSource.query<Array<{ stop_id: string; route_id: string }>>(
      `SELECT stop_id, route_id FROM route_stops
       WHERE agency_id = $1 AND stop_id = ANY($2)`,
      [agencyId, stopIdList],
    );

    const routesByStop = new Map<string, Set<string>>();
    for (const r of routeRows) {
      if (!routesByStop.has(r.stop_id)) routesByStop.set(r.stop_id, new Set());
      routesByStop.get(r.stop_id)!.add(r.route_id);
    }

    const stopMap = new Map(stops.map((s) => [s.stop_id, s]));
    const consumed = new Set<string>();
    const groupAssignments = new Map<string, string | null>();

    for (const stop of stops) {
      if (consumed.has(stop.stop_id)) continue;
      const stopRoutes = routesByStop.get(stop.stop_id) ?? new Set();

      const group: string[] = [stop.stop_id];
      for (const other of stops) {
        if (other.stop_id === stop.stop_id || consumed.has(other.stop_id)) continue;
        if (other.stop_name !== stop.stop_name) continue;
        const dLat = other.lat - stop.lat;
        const dLon = other.lon - stop.lon;
        const meanLatRad = ((stop.lat + other.lat) / 2) * (Math.PI / 180);
        const dLonScaled = dLon * Math.cos(meanLatRad);
        if (Math.sqrt(dLat * dLat + dLonScaled * dLonScaled) > STOP_MERGE_RADIUS_DEG) continue;
        const otherRoutes = routesByStop.get(other.stop_id) ?? new Set();
        let sharesRoute = false;
        for (const rid of stopRoutes) {
          if (otherRoutes.has(rid)) {
            sharesRoute = true;
            break;
          }
        }
        if (sharesRoute) group.push(other.stop_id);
      }

      const groupId = group.length > 1 ? group[0] : null;
      for (const sid of group) {
        consumed.add(sid);
        groupAssignments.set(sid, groupId);
      }
    }

    // Batch-update colocated_group_id
    if (groupAssignments.size > 0) {
      const params: unknown[] = [];
      const cases: string[] = [];
      for (const [sid, gid] of groupAssignments) {
        const n = params.length + 1;
        cases.push(`WHEN stop_id = $${n} THEN $${n + 1}`);
        params.push(sid, gid);
      }
      params.push(agencyId);
      await this.dataSource.query(
        `UPDATE stops SET colocated_group_id = CASE ${cases.join(' ')} ELSE NULL END
         WHERE agency_id = $${params.length}`,
        params,
      );
    }

    const grouppedCount = new Set(groupAssignments.values()).size;
    this.logger.log(
      `Colocated groups computed: ${grouppedCount} groups from ${stops.length} stops`,
    );
  }

  private async copyShapes(tempDir: string, agencyId: string): Promise<void> {
    const filePath = path.join(tempDir, 'shapes.txt');
    if (!fs.existsSync(filePath)) return;
    this.logger.log(`Importing shapes for agency ${agencyId}`);

    interface GtfsShapeRow {
      shape_id: string;
      shape_pt_sequence: string;
      shape_pt_lat: string;
      shape_pt_lon: string;
    }

    const rows: GtfsShapeRow[] = await new Promise((resolve, reject) => {
      const acc: GtfsShapeRow[] = [];
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (r: GtfsShapeRow) => acc.push(r))
        .on('end', () => resolve(acc))
        .on('error', reject);
    });

    const valid = rows.filter((r) => {
      const lat = parseFloat(r.shape_pt_lat);
      const lon = parseFloat(r.shape_pt_lon);
      return !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon);
    });

    const cols = 5;
    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / cols);
    for (let i = 0; i < valid.length; i += chunkSize) {
      const chunk = valid.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const r of chunk) {
        const n = params.length + 1;
        placeholders.push(
          `($${n}, $${n + 1}, $${n + 2}, ST_SetSRID(ST_MakePoint($${n + 3}, $${n + 4}), 4326))`,
        );
        const lat = parseFloat(r.shape_pt_lat);
        const lon = parseFloat(r.shape_pt_lon);
        params.push(agencyId, r.shape_id, parseInt(r.shape_pt_sequence), lon, lat);
      }
      await this.dataSource.query(
        `INSERT INTO shapes (agency_id, shape_id, pt_sequence, location) VALUES ${placeholders.join(', ')}
         ON CONFLICT DO NOTHING`,
        params,
      );
    }
    this.logger.log(`Imported ${valid.length} shape points for agency ${agencyId}`);
  }
}
