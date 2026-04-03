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
  directionId: number | null;
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

    // GIN-friendly query: scalar subquery for agency lets Postgres use the trigram
    // index on stop_name/stop_code directly. COUNT(*) OVER() removes the second
    // round-trip that was needed for pagination totals.
    const likeQ = `%${q}%`;
    const params: unknown[] = [likeQ];
    const agencyFilter = agencyKey
      ? `AND s.agency_id = (SELECT "agencyId" FROM agencies WHERE agency_key = $${params.push(agencyKey)} LIMIT 1)`
      : '';
    const limitSlot = params.push(cappedLimit);
    const offsetSlot = params.push(offset);

    // Step 1: paginated stop filter — fast seq/GIN scan, no route subquery.
    // Filter to parent_station_id IS NULL so we return one entry per station:
    // - parent stations (e.g. place-asmnl) represent the full station hub
    // - standalone stops (bus stops, etc.) have no parent and are returned as-is
    // Directional platform stops (e.g. stop 70088 / 70089) are suppressed here;
    // their departures are shown split by direction on the station detail page.
    const stopRows = await this.dataSource.query<
      Array<{
        id: string;
        stop_id: string;
        stop_name: string;
        stop_code: string | null;
        wheelchair_boarding: number | null;
        lat: string;
        lon: string;
        total_count: string;
        agency_id: string;
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              COUNT(*) OVER() AS total_count,
              s.agency_id
       FROM stops s
       WHERE (s.stop_name ILIKE $1 OR s.stop_code ILIKE $1)
         AND (s.parent_station_id IS NULL OR s.parent_station_id = '')
         ${agencyFilter}
       ORDER BY s.stop_name ASC
       LIMIT $${limitSlot} OFFSET $${offsetSlot}`,
      params,
    );

    // Step 2: batch-fetch all routes for the returned stop IDs in ONE query.
    // Parent stations have no stop_times of their own, so we also look up routes
    // through their children via parent_station_id. COALESCE maps each row to the
    // canonical "group" stop_id (parent station or standalone stop) so the result
    // map aligns with the stop_ids returned in step 1.
    const routesByStopId = new Map<string, StopRouteRef[]>();
    if (stopRows.length > 0) {
      const stopIdList = stopRows.map((r) => r.stop_id);
      const agencyId = stopRows[0].agency_id;
      const routeRows = await this.dataSource.query<
        Array<{
          group_stop_id: string;
          routeId: string;
          shortName: string | null;
          longName: string | null;
          routeType: number;
        }>
      >(
        `SELECT DISTINCT
                COALESCE(child_s.parent_station_id, st2.stop_id) AS group_stop_id,
                r2.route_id  AS "routeId",
                r2.short_name AS "shortName",
                r2.long_name  AS "longName",
                r2.route_type AS "routeType"
         FROM stop_times st2
         JOIN stops child_s ON child_s.stop_id = st2.stop_id AND child_s.agency_id = st2.agency_id
         JOIN trips t2  ON t2.trip_id   = st2.trip_id  AND t2.agency_id  = st2.agency_id
         JOIN routes r2 ON r2.route_id  = t2.route_id  AND r2.agency_id  = t2.agency_id
         WHERE st2.agency_id = $2
           AND (st2.stop_id = ANY($1) OR child_s.parent_station_id = ANY($1))
         ORDER BY group_stop_id, r2.short_name ASC`,
        [stopIdList, agencyId],
      );
      for (const row of routeRows) {
        if (!routesByStopId.has(row.group_stop_id)) routesByStopId.set(row.group_stop_id, []);
        routesByStopId.get(row.group_stop_id)!.push({
          routeId: row.routeId,
          shortName: row.shortName,
          longName: row.longName,
          routeType: row.routeType,
        });
      }
    }

    const total = stopRows.length > 0 ? parseInt(stopRows[0].total_count, 10) : 0;
    const data: StopResponse[] = stopRows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      wheelchairBoarding: row.wheelchair_boarding,
      routes: routesByStopId.get(row.stop_id) ?? [],
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
  ): Promise<{ data: DepartureResponse[]; stopId: string; agencyKey: string; stopName: string }> {
    const cacheKey = `cache:departures:${agencyKey}:${stopId}:${limit}:${after ?? 'now'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as {
        data: DepartureResponse[];
        stopId: string;
        agencyKey: string;
        stopName: string;
      };

    // Resolve agency once so we can use agencyId (UUID) directly in all SQL below —
    // avoids repeated agency_key subquery lookups inside CTEs.
    const [agRow] = await this.dataSource.query<Array<{ agencyId: string; timezone: string }>>(
      `SELECT "agencyId", timezone FROM agencies WHERE agency_key = $1 LIMIT 1`,
      [agencyKey],
    );
    const timezone = agRow?.timezone ?? 'UTC';
    const agencyId: string = agRow?.agencyId;

    // Resolve stop metadata and detect whether this is a parent station.
    // Parent stations (e.g. place-asmnl) have no stop_times of their own; their
    // child platform stops (e.g. 70088, 70089) carry the actual departure rows.
    // We aggregate child stop_ids so a single departures query covers the whole
    // station, and return departures tagged with direction_id for the frontend to
    // render Inbound / Outbound tables.
    const [stopInfo] = await this.dataSource.query<
      Array<{ stop_name: string; child_stop_ids: string[] | null }>
    >(
      `SELECT s.stop_name,
              ARRAY_AGG(c.stop_id) FILTER (WHERE c.stop_id IS NOT NULL) AS child_stop_ids
       FROM stops s
       LEFT JOIN stops c ON c.parent_station_id = s.stop_id AND c.agency_id = s.agency_id
       WHERE s.stop_id = $1 AND s.agency_id = $2
       GROUP BY s.stop_name`,
      [stopId, agencyId],
    );
    const stopName: string = stopInfo?.stop_name ?? stopId;
    const childStopIds = stopInfo?.child_stop_ids;
    // If this stop is a parent station, query all children; otherwise query itself.
    const effectiveStopIds: string[] =
      childStopIds && childStopIds.length > 0 ? childStopIds : [stopId];

    // en-CA locale produces YYYY-MM-DD strings without JSON.stringify overhead
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const todayStr = dateFmt.format(new Date());
    const yesterdayStr = dateFmt.format(new Date(Date.now() - 86_400_000));

    const rows = await this.dataSource.query<
      Array<{
        trip_id: string;
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        trip_headsign: string | null;
        departure_time: string;
        direction_id: number | null;
      }>
    >(
      // stop_slice uses ANY($1) to cover all effective stop_ids in one index scan.
      // today_services is now keyed on agencyId ($2 UUID) directly, removing the
      // inner agency_key subquery that was needed when stopId was the only input.
      `WITH stop_slice AS MATERIALIZED (
         SELECT st.trip_id, st.agency_id, st.departure_time
         FROM stop_times st
         WHERE st.stop_id = ANY($1) AND st.agency_id = $2
       ),
       today_services AS MATERIALIZED (
         SELECT sc.service_id, sc.agency_id, cand.d
         FROM service_calendars sc
         CROSS JOIN (VALUES ($3::date), ($4::date)) AS cand(d)
         WHERE sc.agency_id = $2
           AND sc.start_date <= cand.d
           AND sc.end_date   >= cand.d
           AND CASE EXTRACT(DOW FROM cand.d)::int
                 WHEN 0 THEN sc.sunday
                 WHEN 1 THEN sc.monday
                 WHEN 2 THEN sc.tuesday
                 WHEN 3 THEN sc.wednesday
                 WHEN 4 THEN sc.thursday
                 WHEN 5 THEN sc.friday
                 WHEN 6 THEN sc.saturday
               END = true
       )
       SELECT ss.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
              t.direction_id,
              ((ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS departure_time
       FROM stop_slice ss
       JOIN trips t         ON t.trip_id    = ss.trip_id    AND t.agency_id  = ss.agency_id
       JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
       JOIN routes r        ON r.route_id   = t.route_id    AND r.agency_id  = t.agency_id
       WHERE (ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 >= NOW()
       ORDER BY (ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 ASC
       LIMIT $6`,
      [
        effectiveStopIds,
        agencyId,
        todayStr,
        yesterdayStr,
        timezone,
        Math.min(limit, MAX_SEARCH_LIMIT),
      ],
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
      directionId: row.direction_id ?? null,
    }));

    const result = { data, stopId, agencyKey, stopName };
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
