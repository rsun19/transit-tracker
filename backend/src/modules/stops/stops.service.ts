import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Stop } from './entities/stop.entity';
import { StopTime } from './entities/stop-time.entity';
import { Route } from '@/modules/routes/entities/route.entity';
import { CacheService } from '@/modules/cache/cache.service';
import {
  API_CACHE_DEPARTURES_TTL_S,
  API_CACHE_NEARBY_TTL_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
} from '@/common/constants';

export interface StopRouteRef {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
}

export interface StopResponse {
  id: string;
  stopId: string;
  stopName: string;
  stopCode: string | null;
  lat: number;
  lon: number;
  wheelchairBoarding: number | null;
  distanceMetres?: number;
  routes?: StopRouteRef[];
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

    // Build parameterised queries dynamically based on whether agencyKey is supplied.
    const likeQ = `%${q}%`;
    const dataParams: unknown[] = [likeQ];
    const countParams: unknown[] = [likeQ];
    const agencyClause = agencyKey ? `AND a.agency_key = $${dataParams.push(agencyKey)}` : '';
    // agencyKey occupies same positional slot in count query
    if (agencyKey) countParams.push(agencyKey);
    const limitParam = dataParams.push(cappedLimit);
    const offsetParam = dataParams.push(offset);

    const [rows, countRows] = await Promise.all([
      this.dataSource.query<
        Array<{
          id: string;
          stop_id: string;
          stop_name: string;
          stop_code: string | null;
          wheelchair_boarding: number | null;
          lat: string;
          lon: string;
          routes: StopRouteRef[] | null;
        }>
      >(
        `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
                ST_Y(s.location::geometry) AS lat,
                ST_X(s.location::geometry) AS lon,
                COALESCE(
                  (SELECT json_agg(r)
                   FROM (
                     SELECT DISTINCT r2.route_id AS "routeId",
                                     r2.short_name AS "shortName",
                                     r2.long_name AS "longName",
                                     r2.route_type AS "routeType"
                     FROM stop_times st2
                     JOIN trips t2 ON t2.trip_id = st2.trip_id AND t2.agency_id = st2.agency_id
                     JOIN routes r2 ON r2.route_id = t2.route_id AND r2.agency_id = t2.agency_id
                     WHERE st2.stop_id = s.stop_id AND st2.agency_id = s.agency_id
                     ORDER BY r2.short_name ASC
                   ) r),
                  '[]'::json
                ) AS routes
         FROM stops s
         JOIN agencies a ON a."agencyId" = s.agency_id
         WHERE (s.stop_name ILIKE $1 OR s.stop_code ILIKE $1)
           ${agencyClause}
         ORDER BY s.stop_name ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        dataParams,
      ),
      this.dataSource.query<[{ total: string }]>(
        `SELECT COUNT(*)::text AS total
         FROM stops s
         JOIN agencies a ON a."agencyId" = s.agency_id
         WHERE (s.stop_name ILIKE $1 OR s.stop_code ILIKE $1)
           ${agencyKey ? `AND a.agency_key = $2` : ''}`,
        countParams,
      ),
    ]);

    const total = parseInt(countRows[0]?.total ?? '0', 10);
    const data: StopResponse[] = rows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      wheelchairBoarding: row.wheelchair_boarding,
      routes: row.routes ?? [],
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

    // All date/time filtering is performed in the agency's own timezone so that
    // "today" and "now" are always consistent with the transit service day —
    // regardless of where the DB server or the client is located.
    //
    // We evaluate two candidate service dates — today and yesterday (in the
    // agency's timezone) — so that GTFS post-midnight trips (e.g.
    // departure_time = '25:30:00') scheduled under yesterday's service day but
    // whose UTC instant is still in the future are included in results.
    const rows = await this.dataSource.query<
      Array<{
        trip_id: string;
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        trip_headsign: string | null;
        departure_time: string;
        agency_timezone: string;
      }>
    >(
      `SELECT st.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
              ((cd.candidate_date + st.departure_time)::timestamp AT TIME ZONE a.timezone AT TIME ZONE 'UTC')::text || 'Z' AS departure_time,
              a.timezone AS agency_timezone
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id AND t.agency_id = st.agency_id
       JOIN routes r ON r.route_id = t.route_id AND r.agency_id = t.agency_id
       JOIN service_calendars sc ON sc.service_id = t.service_id AND sc.agency_id = t.agency_id
       JOIN agencies a ON a."agencyId" = st.agency_id
       CROSS JOIN LATERAL (
         SELECT (NOW() AT TIME ZONE a.timezone)::date AS candidate_date
         UNION ALL
         SELECT (NOW() AT TIME ZONE a.timezone)::date - INTERVAL '1 day'
       ) AS cd
       WHERE st.stop_id = $1
         AND a.agency_key = $2
         AND CASE EXTRACT(DOW FROM cd.candidate_date)::int
               WHEN 0 THEN sc.sunday
               WHEN 1 THEN sc.monday
               WHEN 2 THEN sc.tuesday
               WHEN 3 THEN sc.wednesday
               WHEN 4 THEN sc.thursday
               WHEN 5 THEN sc.friday
               WHEN 6 THEN sc.saturday
             END = true
         AND sc.start_date <= cd.candidate_date
         AND sc.end_date   >= cd.candidate_date
         AND (cd.candidate_date + st.departure_time)::timestamp AT TIME ZONE a.timezone >= NOW()
       ORDER BY (cd.candidate_date + st.departure_time)::timestamp AT TIME ZONE a.timezone ASC
       LIMIT $3`,
      [stopId, agencyKey, Math.min(limit, MAX_SEARCH_LIMIT)],
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
        routes: StopRouteRef[] | null;
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              ST_Distance(
                s.location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) AS distance_metres,
              COALESCE(
                (SELECT json_agg(r)
                 FROM (
                   SELECT DISTINCT r2.route_id AS "routeId",
                                   r2.short_name AS "shortName",
                                   r2.long_name AS "longName",
                                   r2.route_type AS "routeType"
                   FROM stop_times st2
                   JOIN trips t2 ON t2.trip_id = st2.trip_id AND t2.agency_id = st2.agency_id
                   JOIN routes r2 ON r2.route_id = t2.route_id AND r2.agency_id = t2.agency_id
                   WHERE st2.stop_id = s.stop_id AND st2.agency_id = s.agency_id
                   ORDER BY r2.short_name ASC
                 ) r),
                '[]'::json
              ) AS routes
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
          routes: row.routes ?? [],
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
