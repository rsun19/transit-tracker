import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CacheService } from '@/modules/cache/cache.service';
import { API_CACHE_ROUTES_TTL_S } from '@/common/constants';

export interface TripStopResponse {
  sequence: number;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  realtimeArrival: string | null;
  scheduledDeparture: string | null;
}

export interface TripDetailResponse {
  tripId: string;
  routeId: string;
  headsign: string | null;
  stops: TripStopResponse[];
}

@Injectable()
export class TripsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  async findOne(tripId: string, agencyKey: string): Promise<TripDetailResponse> {
    const cacheKey = `cache:trip:${agencyKey}:${tripId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as TripDetailResponse;

    const rows = await this.dataSource.query<
      Array<{
        trip_id: string;
        route_id: string;
        trip_headsign: string | null;
        stop_sequence: number;
        stop_id_gtfs: string;
        stop_name: string;
        stop_code: string | null;
        lat: number;
        lon: number;
        arrival_time: string | null;
        departure_time: string | null;
      }>
    >(
      `SELECT t.trip_id, t.route_id, t.trip_headsign,
              st.stop_sequence,
              s.stop_id AS stop_id_gtfs,
              s.stop_name,
              s.stop_code,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              ((CURRENT_DATE + st.arrival_time)::timestamp AT TIME ZONE a.timezone AT TIME ZONE 'UTC')::text || 'Z' AS arrival_time,
              ((CURRENT_DATE + st.departure_time)::timestamp AT TIME ZONE a.timezone AT TIME ZONE 'UTC')::text || 'Z' AS departure_time
       FROM trips t
       JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
       JOIN stops s ON s.stop_id = st.stop_id AND s.agency_id = t.agency_id
       JOIN agencies a ON a."agencyId" = t.agency_id
       WHERE t.trip_id = $1 AND a.agency_key = $2
       ORDER BY st.stop_sequence ASC`,
      [tripId, agencyKey],
    );

    if (rows.length === 0) throw new NotFoundException(`Trip ${tripId} not found`);

    const result: TripDetailResponse = {
      tripId: rows[0].trip_id,
      routeId: rows[0].route_id,
      headsign: rows[0].trip_headsign,
      stops: rows.map((row) => ({
        sequence: row.stop_sequence,
        stopId: row.stop_id_gtfs,
        stopName: row.stop_name,
        stopCode: row.stop_code,
        lat: row.lat,
        lon: row.lon,
        realtimeArrival: row.arrival_time,
        scheduledDeparture: row.departure_time,
      })),
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ROUTES_TTL_S);
    return result;
  }
}
