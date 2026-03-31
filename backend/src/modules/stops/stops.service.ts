import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Stop } from './entities/stop.entity';
import { StopTime } from './entities/stop-time.entity';
import { Route } from '../routes/entities/route.entity';
import { CacheService } from '../cache/cache.service';
import {
  API_CACHE_DEPARTURES_TTL_S,
  API_CACHE_NEARBY_TTL_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
} from '../../common/constants';

export interface StopResponse {
  id: string;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  wheelchairBoarding: number | null;
  distanceMetres?: number;
}

export interface DepartureResponse {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  headsign: string | null;
  scheduledDeparture: string;
  realtimeDelaySeconds: number | null;
  hasRealtime: boolean;
}

@Injectable()
export class StopsService {
  constructor(
    @InjectRepository(Stop) private readonly stopRepo: Repository<Stop>,
    @InjectRepository(StopTime) private readonly stopTimeRepo: Repository<StopTime>,
    @InjectRepository(Route) private readonly routeRepo: Repository<Route>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  async search(
    q: string,
    agencyKey?: string,
    limit = DEFAULT_SEARCH_LIMIT,
    offset = 0,
  ): Promise<{ data: StopResponse[]; total: number }> {
    const cappedLimit = Math.min(limit, MAX_SEARCH_LIMIT);
    const cacheKey = `cache:stops:search:${agencyKey ?? 'all'}:${q}:${cappedLimit}:${offset}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as { data: StopResponse[]; total: number };

    const qb = this.stopRepo
      .createQueryBuilder('s')
      .leftJoin('s.agency', 'a')
      .addSelect(`ST_X(s.location::geometry)`, 'lon')
      .addSelect(`ST_Y(s.location::geometry)`, 'lat');

    if (agencyKey) qb.andWhere('a.agency_key = :agencyKey', { agencyKey });
    qb.andWhere('(s.stop_name ILIKE :q OR s.stop_code ILIKE :q)', { q: `%${q}%` });

    const rawResults = await qb
      .orderBy('s.stopName', 'ASC')
      .skip(offset)
      .take(cappedLimit)
      .getRawAndEntities();

    const total = await qb.getCount();
    const data = rawResults.entities.map((stop, i) => ({
      id: stop.id,
      stopId: stop.stopId,
      stopName: stop.stopName,
      stopCode: stop.stopCode,
      lat: parseFloat(rawResults.raw[i]?.lat ?? '0'),
      lon: parseFloat(rawResults.raw[i]?.lon ?? '0'),
      wheelchairBoarding: stop.wheelchairBoarding,
    }));

    const result = { data, total };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_DEPARTURES_TTL_S);
    return result;
  }

  async getDepartures(
    stopId: string,
    agencyKey: string,
    limit = DEFAULT_SEARCH_LIMIT,
    after?: string,
  ): Promise<{ data: DepartureResponse[]; stopId: string; agencyKey: string }> {
    const cacheKey = `cache:departures:${agencyKey}:${stopId}:${limit}:${after ?? 'now'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as { data: DepartureResponse[]; stopId: string; agencyKey: string };

    // Get today's day of week to look up active service_ids
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayCol = dayNames[now.getDay()];
    const todayDate = now.toISOString().slice(0, 10).replace(/-/g, '');

    const rows = await this.dataSource.query<
      Array<{
        trip_id: string;
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        trip_headsign: string | null;
        departure_time: string;
      }>
    >(
      `SELECT st.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
              (CURRENT_DATE + st.departure_time)::text AS departure_time
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id AND t.agency_id = st.agency_id
       JOIN routes r ON r.route_id = t.route_id AND r.agency_id = t.agency_id
       JOIN service_calendars sc ON sc.service_id = t.service_id AND sc.agency_id = t.agency_id
       JOIN agencies a ON a."agencyId" = st.agency_id
       WHERE st.stop_id = $1
         AND a.agency_key = $2
         AND sc.${dayCol} = true
         AND sc.start_date <= $3
         AND sc.end_date >= $3
         AND (CURRENT_DATE + st.departure_time) >= NOW()
       ORDER BY st.departure_time ASC
       LIMIT $4`,
      [stopId, agencyKey, todayDate, Math.min(limit, MAX_SEARCH_LIMIT)],
    );

    const data: DepartureResponse[] = rows.map((row) => ({
      tripId: row.trip_id,
      routeId: row.route_id,
      routeShortName: row.short_name,
      routeLongName: row.long_name,
      headsign: row.trip_headsign,
      scheduledDeparture: row.departure_time,
      realtimeDelaySeconds: null,
      hasRealtime: false,
    }));

    const result = { data, stopId, agencyKey };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_DEPARTURES_TTL_S);
    return result;
  }

  async getRoutesForStop(
    stopId: string,
    agencyKey: string,
  ): Promise<{
    data: {
      routeId: string;
      shortName: string | null;
      longName: string | null;
      routeType: number;
    }[];
  }> {
    const rows = await this.dataSource.query<
      Array<{
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        route_type: number;
      }>
    >(
      `SELECT DISTINCT r.route_id, r.short_name, r.long_name, r.route_type
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id AND t.agency_id = st.agency_id
       JOIN routes r ON r.route_id = t.route_id AND r.agency_id = t.agency_id
       JOIN agencies a ON a."agencyId" = st.agency_id
       WHERE st.stop_id = $1 AND a.agency_key = $2
       ORDER BY r.short_name ASC`,
      [stopId, agencyKey],
    );

    return {
      data: rows.map((r) => ({
        routeId: r.route_id,
        shortName: r.short_name,
        longName: r.long_name,
        routeType: r.route_type,
      })),
    };
  }

  async getNearbyStops(params: {
    lat: number;
    lon: number;
    radiusM?: number;
    agencyKey?: string;
    limit?: number;
  }): Promise<{
    data: (StopResponse & { nextDeparture?: DepartureResponse | null })[];
    searchCentre: { lat: number; lon: number };
    radiusMetres: number;
  }> {
    const radius = Math.min(params.radiusM ?? NEARBY_DEFAULT_RADIUS_M, NEARBY_MAX_RADIUS_M);
    const limit = Math.min(params.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const latRounded = params.lat.toFixed(3);
    const lonRounded = params.lon.toFixed(3);

    const cacheKey = `cache:stops:nearby:${latRounded}:${lonRounded}:${radius}:${params.agencyKey ?? 'all'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as ReturnType<typeof this.getNearbyStops> extends Promise<infer T>
        ? T
        : never;

    const agencyFilter = params.agencyKey
      ? `AND a.agency_key = '${params.agencyKey.replace(/'/g, "''")}'`
      : '';

    const rows = await this.dataSource.query<
      Array<{
        id: string;
        stop_id: string;
        stop_name: string;
        stop_code: string | null;
        wheelchair_boarding: number | null;
        lat: number;
        lon: number;
        distance_metres: number;
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              ST_Distance(
                s.location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) AS distance_metres
       FROM stops s
       JOIN agencies a ON a."agencyId" = s.agency_id
       WHERE ST_DWithin(
           s.location::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           $3
         )
         ${agencyFilter}
       ORDER BY s.location::geography <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
       LIMIT $4`,
      [params.lat, params.lon, radius, limit],
    );

    const stopsWithDepartures = await Promise.all(
      rows.map(async (row) => {
        const stop: StopResponse & { nextDeparture?: DepartureResponse | null } = {
          id: row.id,
          stopId: row.stop_id,
          stopName: row.stop_name,
          stopCode: row.stop_code,
          lat: row.lat,
          lon: row.lon,
          wheelchairBoarding: row.wheelchair_boarding,
          distanceMetres: Math.round(row.distance_metres),
        };

        // Augment with next departure (US3 AS2)
        if (params.agencyKey) {
          try {
            const deps = await this.getDepartures(row.stop_id, params.agencyKey, 1);
            stop.nextDeparture = deps.data[0] ?? null;
          } catch {
            stop.nextDeparture = null;
          }
        }

        return stop;
      }),
    );

    const result = {
      data: stopsWithDepartures,
      searchCentre: { lat: params.lat, lon: params.lon },
      radiusMetres: radius,
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_NEARBY_TTL_S);
    return result;
  }
}
