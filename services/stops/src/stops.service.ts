import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Stop,
  StopTime,
  Route,
  API_CACHE_ARRIVALS_TTL_S,
  API_CACHE_NEARBY_TTL_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
} from '@transit-tracker/shared';
import { CacheService } from './cache/cache.service';
import { reconcileAddedTrips } from './reconcileAddedTrips';
import {
  StopRouteRef,
  StopResponse,
  ArrivalResponse,
  AddedTripEntry,
  AddedTrip,
  ArrivalRow,
} from './stops.types';

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
    const cacheKey = `cache:stops:search:v4:${agencyKey ?? 'all'}:${q}:${cappedLimit}:${offset}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as { data: StopResponse[]; total: number };

    const likeQ = `%${q}%`;
    const params: unknown[] = [likeQ];
    const agencyFilter = agencyKey
      ? `AND s.agency_id = (SELECT "agencyId" FROM agencies WHERE agency_key = $${params.push(agencyKey)} LIMIT 1)`
      : '';
    const limitSlot = params.push(cappedLimit);
    const offsetSlot = params.push(offset);

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
        colocated_group_id: string | null;
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              COUNT(*) OVER() AS total_count,
              s.agency_id,
              s.colocated_group_id
       FROM stops s
       WHERE (s.stop_name ILIKE $1 OR s.stop_code ILIKE $1)
         AND (s.parent_station_id IS NULL OR s.parent_station_id = '')
         ${agencyFilter}
       ORDER BY s.stop_name ASC
       LIMIT $${limitSlot} OFFSET $${offsetSlot}`,
      params,
    );

    const routesByStopId = new Map<string, StopRouteRef[]>();
    if (stopRows.length > 0) {
      const stopIdList = stopRows.map((r) => r.stop_id);
      const routeRows = await this.dataSource.query<
        Array<{
          group_stop_id: string;
          agency_id: string;
          routeId: string;
          shortName: string | null;
          longName: string | null;
          routeType: number;
        }>
      >(
        `SELECT rs.stop_id AS group_stop_id,
                rs.agency_id,
                rs.route_id AS "routeId",
                rs.short_name AS "shortName",
                rs.long_name AS "longName",
                rs.route_type AS "routeType"
         FROM route_stops rs
         WHERE rs.stop_id = ANY($1)
         ORDER BY rs.stop_id, rs.short_name ASC`,
        [stopIdList],
      );
      for (const row of routeRows) {
        const key = `${row.agency_id}:${row.group_stop_id}`;
        if (!routesByStopId.has(key)) routesByStopId.set(key, []);
        routesByStopId.get(key)!.push({
          routeId: row.routeId,
          shortName: row.shortName,
          longName: row.longName,
          routeType: row.routeType,
        });
      }
    }

    const total = stopRows.length > 0 ? parseInt(stopRows[0].total_count, 10) : 0;
    const rawData: StopResponse[] = stopRows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      routes: routesByStopId.get(`${row.agency_id}:${row.stop_id}`) ?? [],
    }));

    // Merge co-located stops using precomputed colocated_group_id
    const groupMap = new Map<string, StopResponse[]>();
    for (let i = 0; i < rawData.length; i++) {
      const gid = stopRows[i].colocated_group_id ?? rawData[i].stopId;
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid)!.push(rawData[i]);
    }
    const data: StopResponse[] = [];
    for (const [, group] of groupMap) {
      const merged = { ...group[0] };
      const seenRoutes = new Set<string>();
      const allRoutes: StopRouteRef[] = [];
      for (const s of group) {
        for (const r of s.routes ?? []) {
          if (!seenRoutes.has(r.routeId)) {
            seenRoutes.add(r.routeId);
            allRoutes.push(r);
          }
        }
      }
      allRoutes.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? ''));
      merged.routes = allRoutes;
      data.push(merged);
    }

    const searchResultPriority = (routes: StopRouteRef[] | undefined): number => {
      if (!routes) return 4;
      const types = new Set(routes.map((r) => r.routeType));
      if (types.has(1)) return 0;
      if (types.has(0)) return 1;
      if (types.has(2)) return 2;
      if (types.has(4)) return 3;
      return 4;
    };
    data.sort((a, b) => searchResultPriority(a.routes) - searchResultPriority(b.routes));

    const result = { data, total };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ARRIVALS_TTL_S);
    return result;
  }

  async getArrivals(
    stopId: string,
    agencyKey: string,
    limit = DEFAULT_SEARCH_LIMIT,
    after?: string,
  ): Promise<{ data: ArrivalResponse[]; stopId: string; agencyKey: string; stopName: string }> {
    const cacheKey = `cache:arrivals:v5:${agencyKey}:${stopId}:${limit}:${after ?? 'now'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as {
        data: ArrivalResponse[];
        stopId: string;
        agencyKey: string;
        stopName: string;
      };

    const [agRow] = await this.dataSource.query<Array<{ agencyId: string; timezone: string }>>(
      `SELECT "agencyId", timezone FROM agencies WHERE agency_key = $1 LIMIT 1`,
      [agencyKey],
    );
    if (!agRow) throw new NotFoundException(`Agency not found for agencyKey: ${agencyKey}`);
    const timezone = agRow.timezone;
    const agencyId: string = agRow.agencyId;

    const [stopInfo] = await this.dataSource.query<
      Array<{
        stop_name: string;
        parent_station_id: string | null;
      }>
    >(
      `SELECT s.stop_name, s.parent_station_id
       FROM stops s
       WHERE s.stop_id = $1 AND s.agency_id = $2
       LIMIT 1`,
      [stopId, agencyId],
    );
    const stopName: string = stopInfo?.stop_name ?? stopId;
    const parentStationId = stopInfo?.parent_station_id ?? null;

    let effectiveStopIds: string[];
    if (parentStationId) {
      // Child platform — find siblings that have stop_times via route_stops
      const siblingRows = await this.dataSource.query<Array<{ stop_id: string }>>(
        `SELECT s.stop_id FROM stops s
         WHERE s.parent_station_id = $1 AND s.agency_id = $2
           AND EXISTS (SELECT 1 FROM route_stops rs WHERE rs.stop_id = s.stop_id AND rs.agency_id = s.agency_id)`,
        [parentStationId, agencyId],
      );
      effectiveStopIds = siblingRows.length > 0 ? siblingRows.map((r) => r.stop_id) : [stopId];
    } else {
      // Check if this is a parent station — find children that have stop_times
      const childRows = await this.dataSource.query<Array<{ stop_id: string }>>(
        `SELECT s.stop_id FROM stops s
         WHERE s.parent_station_id = $1 AND s.agency_id = $2
           AND EXISTS (SELECT 1 FROM route_stops rs WHERE rs.stop_id = s.stop_id AND rs.agency_id = s.agency_id)`,
        [stopId, agencyId],
      );
      if (childRows.length > 0) {
        effectiveStopIds = childRows.map((r) => r.stop_id);
      } else {
        // Standalone stop — use precomputed colocated_group_id if available
        const [colocated] = await this.dataSource.query<
          Array<{ colocated_group_id: string | null }>
        >(`SELECT colocated_group_id FROM stops WHERE stop_id = $1 AND agency_id = $2`, [
          stopId,
          agencyId,
        ]);
        if (colocated?.colocated_group_id) {
          const groupRows = await this.dataSource.query<Array<{ stop_id: string }>>(
            `SELECT stop_id FROM stops
             WHERE colocated_group_id = $1 AND agency_id = $2
               AND stop_id != $3`,
            [colocated.colocated_group_id, agencyId, stopId],
          );
          effectiveStopIds = [stopId, ...groupRows.map((r) => r.stop_id)];
        } else {
          effectiveStopIds = [stopId];
        }
      }
    }

    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const todayStr = dateFmt.format(new Date());
    const yesterdayStr = dateFmt.format(new Date(Date.now() - 86_400_000));

    let afterTimestamp: string;
    if (after) {
      const afterDate = new Date(after);
      afterTimestamp = !isNaN(afterDate.getTime())
        ? afterDate.toISOString()
        : new Date(Date.now() - 10 * 60 * 1000).toISOString();
    } else {
      afterTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    }

    const rows = await this.dataSource.query<Array<ArrivalRow>>(
      `WITH today_services AS MATERIALIZED (
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
      SELECT trip_id, route_id, short_name, long_name, trip_headsign, direction_id, arrival_time, stop_id
      FROM (
        SELECT DISTINCT ON (t.trip_id, ts.d)
          st.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
          t.direction_id,
          ((ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS arrival_time,
          st.stop_id
        FROM stop_times st
        JOIN trips t         ON t.trip_id    = st.trip_id    AND t.agency_id  = st.agency_id
        JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
        JOIN routes r        ON r.route_id   = t.route_id    AND r.agency_id  = t.agency_id
        WHERE st.stop_id = ANY($1) AND st.agency_id = $2
          AND (ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 >= $6::timestamp
        ORDER BY t.trip_id, ts.d, (ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 ASC
      ) deduped
      ORDER BY arrival_time ASC
      LIMIT $7`,
      [
        effectiveStopIds,
        agencyId,
        todayStr,
        yesterdayStr,
        timezone,
        afterTimestamp,
        Math.min(limit, MAX_SEARCH_LIMIT),
      ],
    );

    const realtimeMap = new Map<string, Record<string, { arrivalTime?: number; delay?: number }>>();
    if (rows.length > 0) {
      try {
        const redis = this.cacheService.getClient();
        const tripIds = rows.map((r) => r.trip_id);
        const realtimeValues = await redis.hmget(`trip_updates:${agencyKey}`, ...tripIds);
        tripIds.forEach((tripId, i) => {
          const val = realtimeValues[i];
          if (val !== null) {
            try {
              const parsed = JSON.parse(val);
              if (parsed && typeof parsed === 'object') {
                realtimeMap.set(tripId, parsed);
              }
            } catch {
              const delay = parseInt(val, 10);
              if (!isNaN(delay)) {
                realtimeMap.set(tripId, { legacy: { delay } });
              }
            }
          }
        });
      } catch {
        /* Redis unavailable */
      }
    }

    const data: ArrivalResponse[] = rows.map((row) => {
      const tripRealtime = realtimeMap.get(row.trip_id) ?? {};
      const stopRealtime = tripRealtime[row.stop_id] ?? null;
      let realtimeArrival: string = row.arrival_time;
      let realtimeArrivalSeconds: number = new Date(row.arrival_time).getTime() / 1000;
      let realtimeDelay: number | null = null;
      let hasRealtime = false;
      if (stopRealtime) {
        const rt = stopRealtime as {
          arrivalTime?: number;
          delay?: number;
          realtimeArrival?: string;
        };
        if (typeof rt.realtimeArrival === 'string') {
          realtimeArrival = rt.realtimeArrival;
          realtimeArrivalSeconds = new Date(rt.realtimeArrival).getTime() / 1000;
          hasRealtime = true;
        } else if (rt.arrivalTime) {
          realtimeArrival = new Date(rt.arrivalTime * 1000).toISOString();
          realtimeArrivalSeconds = rt.arrivalTime;
          hasRealtime = true;
        }
        if (typeof rt.delay === 'number') {
          realtimeDelay = rt.delay;
          hasRealtime = true;
        }
      }
      return {
        tripId: row.trip_id,
        routeId: row.route_id,
        routeShortName: row.short_name,
        routeLongName: row.long_name,
        headsign: row.trip_headsign,
        realtimeArrival,
        realtimeArrivalSeconds,
        realtimeDelaySeconds: realtimeDelay,
        hasRealtime,
        directionId: row.direction_id ?? null,
      };
    });

    try {
      const redis = this.cacheService.getClient();
      const addedRaw = await redis.hgetall(`added_trips:${agencyKey}`);
      if (addedRaw && Object.keys(addedRaw).length > 0) {
        const nowMs = Date.now();
        const effectiveStopIdSet = new Set(effectiveStopIds);
        const pendingAdded: Array<{ trip: AddedTrip; arrivalTime: number }> = [];
        const addedRouteIds = new Set<string>();

        for (const raw of Object.values(addedRaw)) {
          const trip: AddedTrip = JSON.parse(raw);
          for (const stop of trip.stops) {
            if (effectiveStopIdSet.has(stop.stopId) && stop.arrivalTime * 1000 > nowMs) {
              addedRouteIds.add(trip.routeId);
              pendingAdded.push({ trip, arrivalTime: stop.arrivalTime });
              break;
            }
          }
        }

        if (pendingAdded.length > 0) {
          const addedRouteIdList = [...addedRouteIds];
          const [routeRows, headsignRows] = await Promise.all([
            this.dataSource.query<
              Array<{ route_id: string; short_name: string | null; long_name: string | null }>
            >(
              `SELECT route_id, short_name, long_name FROM routes WHERE agency_id = $1 AND route_id = ANY($2)`,
              [agencyId, addedRouteIdList],
            ),
            this.dataSource.query<
              Array<{ route_id: string; direction_id: number | null; trip_headsign: string }>
            >(
              `SELECT DISTINCT ON (route_id, direction_id) route_id, direction_id, trip_headsign
               FROM trips WHERE agency_id = $1 AND route_id = ANY($2) AND trip_headsign IS NOT NULL
               ORDER BY route_id, direction_id, trip_headsign`,
              [agencyId, addedRouteIdList],
            ),
          ]);

          const routeMap = new Map(routeRows.map((r) => [r.route_id, r]));
          const headsignMap = new Map(
            headsignRows.map((r) => [`${r.route_id}|${r.direction_id}`, r.trip_headsign]),
          );

          const entries: AddedTripEntry[] = pendingAdded.map(({ trip, arrivalTime }) => ({
            trip,
            arrivalTime,
            routeShortName: routeMap.get(trip.routeId)?.short_name ?? null,
            routeLongName: routeMap.get(trip.routeId)?.long_name ?? null,
            headsignFallback: headsignMap.get(`${trip.routeId}|${trip.directionId}`) ?? null,
          }));

          reconcileAddedTrips(data, entries);
        }
      }
    } catch {
      /* Redis unavailable */
    }

    data.sort((a, b) => {
      const aEff = new Date(a.realtimeArrival).getTime() / 1000 + (a.realtimeDelaySeconds ?? 0);
      const bEff = new Date(b.realtimeArrival).getTime() / 1000 + (b.realtimeDelaySeconds ?? 0);
      return aEff - bEff;
    });

    const result = { data, stopId, agencyKey, stopName };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ARRIVALS_TTL_S);
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
    const cacheKey = `cache:stops:routes:${agencyKey}:${stopId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return { data: JSON.parse(cached) };

    const rows = await this.dataSource.query<
      Array<{
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        route_type: number;
      }>
    >(
      `SELECT rs.route_id, rs.short_name, rs.long_name, rs.route_type
       FROM route_stops rs
       JOIN agencies a ON a."agencyId" = rs.agency_id
       WHERE rs.stop_id = $1 AND a.agency_key = $2
       ORDER BY rs.short_name ASC`,
      [stopId, agencyKey],
    );

    const data = rows.map((r) => ({
      routeId: r.route_id,
      shortName: r.short_name,
      longName: r.long_name,
      routeType: r.route_type,
    }));
    await this.cacheService.set(cacheKey, JSON.stringify(data), 86400);
    return { data };
  }

  async getNearbyStops(params: {
    lat: number;
    lon: number;
    radiusM?: number;
    agencyKey?: string;
    limit?: number;
  }): Promise<{
    data: (StopResponse & { nextArrival?: ArrivalResponse | null })[];
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

    let agencyId: string | undefined;
    let timezone: string | undefined;
    if (params.agencyKey) {
      const [agRow] = await this.dataSource.query<Array<{ agencyId: string; timezone: string }>>(
        `SELECT "agencyId", timezone FROM agencies WHERE agency_key = $1 LIMIT 1`,
        [params.agencyKey],
      );
      agencyId = agRow?.agencyId;
      timezone = agRow?.timezone;
    }

    const agencyFilter = agencyId ? `AND s.agency_id = $5` : '';
    const queryParams: unknown[] = [params.lat, params.lon, radius, limit];
    if (agencyId) queryParams.push(agencyId);

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
        agency_id: string;
        colocated_group_id: string | null;
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              ST_Distance(s.location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_metres,
              s.agency_id,
              s.colocated_group_id
       FROM stops s
       WHERE ST_DWithin(s.location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
         ${agencyFilter}
       ORDER BY s.location::geography <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
       LIMIT $4`,
      queryParams,
    );

    const routesByStopId = new Map<string, StopRouteRef[]>();
    if (rows.length > 0) {
      const stopIdList = rows.map((r) => r.stop_id);
      const batchAgencyId = agencyId ?? rows[0].agency_id;
      const routeRows = await this.dataSource.query<
        Array<{
          group_stop_id: string;
          agency_id: string;
          routeId: string;
          shortName: string | null;
          longName: string | null;
          routeType: number;
        }>
      >(
        `SELECT rs.stop_id AS group_stop_id,
                rs.agency_id,
                rs.route_id AS "routeId",
                rs.short_name AS "shortName",
                rs.long_name AS "longName",
                rs.route_type AS "routeType"
         FROM route_stops rs
         WHERE rs.stop_id = ANY($1)
         ORDER BY rs.stop_id, rs.short_name ASC`,
        [stopIdList],
      );
      for (const row of routeRows) {
        const key = `${row.agency_id}:${row.group_stop_id}`;
        if (!routesByStopId.has(key)) routesByStopId.set(key, []);
        routesByStopId.get(key)!.push({
          routeId: row.routeId,
          shortName: row.shortName,
          longName: row.longName,
          routeType: row.routeType,
        });
      }
    }

    let nextArrivalByStopId = new Map<string, ArrivalResponse>();
    if (agencyId && timezone && rows.length > 0) {
      nextArrivalByStopId = await this.batchGetNextArrivals(
        rows.map((r) => r.stop_id),
        params.agencyKey!,
        agencyId,
        timezone,
      );
    }

    const stops: StopResponse[] = rows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: row.lat,
      lon: row.lon,
      distanceMetres: Math.round(row.distance_metres),
      routes: routesByStopId.get(`${row.agency_id}:${row.stop_id}`) ?? [],
    }));

    // Merge co-located stops using precomputed colocated_group_id
    const groupMap = new Map<string, StopResponse[]>();
    for (const s of stops) {
      const gid = rows.find((r) => r.stop_id === s.stopId)?.colocated_group_id ?? s.stopId;
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid)!.push(s);
    }

    const mergedData: (StopResponse & { nextArrival?: ArrivalResponse | null })[] = [];
    for (const [, group] of groupMap) {
      const merged = { ...group[0] };
      const seenRoutes = new Set<string>();
      const allRoutes: StopRouteRef[] = [];
      for (const s of group) {
        for (const r of s.routes ?? []) {
          if (!seenRoutes.has(r.routeId)) {
            seenRoutes.add(r.routeId);
            allRoutes.push(r);
          }
        }
      }
      allRoutes.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? ''));
      merged.routes = allRoutes;

      let bestArrival: ArrivalResponse | null = null;
      for (const s of group) {
        const arr = nextArrivalByStopId.get(s.stopId) ?? null;
        if (arr) {
          const arrTime =
            new Date(arr.realtimeArrival).getTime() / 1000 + (arr.realtimeDelaySeconds ?? 0);
          const bestTime = bestArrival
            ? new Date(bestArrival.realtimeArrival).getTime() / 1000 +
              (bestArrival.realtimeDelaySeconds ?? 0)
            : Infinity;
          if (!bestArrival || arrTime < bestTime) bestArrival = arr;
        }
      }
      mergedData.push({ ...merged, nextArrival: bestArrival });
    }

    const result = {
      data: mergedData,
      searchCentre: { lat: params.lat, lon: params.lon },
      radiusMetres: radius,
    };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_NEARBY_TTL_S);
    return result;
  }

  private async batchGetNextArrivals(
    stopIds: string[],
    agencyKey: string,
    agencyId: string,
    timezone: string,
  ): Promise<Map<string, ArrivalResponse>> {
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const todayStr = dateFmt.format(new Date());
    const yesterdayStr = dateFmt.format(new Date(Date.now() - 86_400_000));

    const rows = await this.dataSource.query<
      Array<{
        stop_id: string;
        trip_id: string;
        route_id: string;
        short_name: string | null;
        long_name: string | null;
        trip_headsign: string | null;
        arrival_time: string;
        direction_id: number | null;
      }>
    >(
      `WITH today_services AS MATERIALIZED (
         SELECT sc.service_id, sc.agency_id, cand.d
         FROM service_calendars sc
         CROSS JOIN (VALUES ($3::date), ($4::date)) AS cand(d)
         WHERE sc.agency_id = $2
           AND sc.start_date <= cand.d AND sc.end_date >= cand.d
           AND CASE EXTRACT(DOW FROM cand.d)::int
                 WHEN 0 THEN sc.sunday WHEN 1 THEN sc.monday
                 WHEN 2 THEN sc.tuesday WHEN 3 THEN sc.wednesday
                 WHEN 4 THEN sc.thursday WHEN 5 THEN sc.friday
                 WHEN 6 THEN sc.saturday
               END = true
       ),
       expanded_stops AS MATERIALIZED (
         SELECT stop_id AS parent_stop_id, stop_id AS effective_stop_id
         FROM stops WHERE stop_id = ANY($1) AND agency_id = $2
         UNION ALL
         SELECT parent_station_id AS parent_stop_id, stop_id AS effective_stop_id
         FROM stops WHERE parent_station_id = ANY($1) AND agency_id = $2
       )
       SELECT DISTINCT ON (es.parent_stop_id)
              es.parent_stop_id AS stop_id,
              dep.trip_id, dep.route_id, dep.short_name, dep.long_name,
              dep.trip_headsign, dep.direction_id, dep.arrival_time
       FROM expanded_stops es
       LEFT JOIN LATERAL (
         SELECT st.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
                t.direction_id,
                ((ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS arrival_time,
                (ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 AS eff_ts
         FROM stop_times st
         JOIN trips t         ON t.trip_id    = st.trip_id  AND t.agency_id = st.agency_id
         JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
         JOIN routes r        ON r.route_id   = t.route_id  AND r.agency_id  = t.agency_id
         WHERE st.stop_id = es.effective_stop_id AND st.agency_id = $2
           AND (ts.d + st.arrival_time)::timestamp AT TIME ZONE $5 >= NOW()
         ORDER BY eff_ts ASC
         LIMIT 1
       ) dep ON true
       WHERE dep.trip_id IS NOT NULL
       ORDER BY es.parent_stop_id, dep.eff_ts ASC`,
      [stopIds, agencyId, todayStr, yesterdayStr, timezone],
    );

    const delayMap = new Map<string, number>();
    if (rows.length > 0) {
      try {
        const redis = this.cacheService.getClient();
        const tripIds = rows.map((r) => r.trip_id);
        const delayValues = await redis.hmget(`trip_updates:${agencyKey}`, ...tripIds);
        tripIds.forEach((tripId, i) => {
          const val = delayValues[i];
          if (val !== null) delayMap.set(tripId, parseInt(val, 10));
        });
      } catch {
        /* Redis unavailable */
      }
    }

    const result = new Map<string, ArrivalResponse>();
    for (const row of rows) {
      const delay = delayMap.get(row.trip_id) ?? null;
      result.set(row.stop_id, {
        tripId: row.trip_id,
        routeId: row.route_id,
        routeShortName: row.short_name,
        routeLongName: row.long_name,
        headsign: row.trip_headsign,
        realtimeArrival: row.arrival_time,
        realtimeDelaySeconds: delay,
        hasRealtime: delay !== null,
        directionId: row.direction_id ?? null,
      });
    }
    return result;
  }
}
