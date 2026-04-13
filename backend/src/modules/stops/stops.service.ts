import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Stop } from './entities/stop.entity';
import { StopTime } from './entities/stop-time.entity';
import { Route } from '@/modules/routes/entities/route.entity';
import { CacheService } from '@/modules/cache/cache.service';
import {
  API_CACHE_ARRIVALS_TTL_S,
  API_CACHE_NEARBY_TTL_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
} from '@/common/constants';
import { reconcileAddedTrips } from './reconcileAddedTrips';
import { mergeColocatedStops } from './mergeColocatedStops';
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
    const cacheKey = `cache:stops:search:v3:${agencyKey ?? 'all'}:${q}:${cappedLimit}:${offset}`;
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
    // their arrivals are shown split by direction on the station detail page.
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
        // Expand stop IDs on the small stops table first (fast), then join into
        // stop_times using the idx_stop_times_agency_stop_dept index per effective
        // stop_id. This avoids the OR condition that previously prevented index use
        // on the 4M+ row stop_times table.
        `WITH expanded_stops AS MATERIALIZED (
           SELECT stop_id AS query_stop_id, stop_id AS effective_stop_id
           FROM stops WHERE stop_id = ANY($1) AND agency_id = $2
           UNION ALL
           SELECT parent_station_id AS query_stop_id, stop_id AS effective_stop_id
           FROM stops WHERE parent_station_id = ANY($1) AND agency_id = $2
         )
         SELECT DISTINCT
                es.query_stop_id       AS group_stop_id,
                r2.route_id            AS "routeId",
                r2.short_name          AS "shortName",
                r2.long_name           AS "longName",
                r2.route_type          AS "routeType"
         FROM expanded_stops es
         JOIN stop_times st2 ON st2.stop_id = es.effective_stop_id AND st2.agency_id = $2
         JOIN trips t2  ON t2.trip_id  = st2.trip_id  AND t2.agency_id  = st2.agency_id
         JOIN routes r2 ON r2.route_id = t2.route_id  AND r2.agency_id  = t2.agency_id
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
    const rawData: StopResponse[] = stopRows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      routes: routesByStopId.get(row.stop_id) ?? [],
    }));

    const data = mergeColocatedStops(rawData);

    // Sort search results by the "best" mode at each stop:
    //   0 → Subway/Metro (route_type 1)
    //   1 → Light rail / Tram / BRT (route_type 0)
    //   2 → Commuter rail (route_type 2)
    //   3 → Ferry (route_type 4)
    //   4 → Everything else (bus, etc.)
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
    const cacheKey = `cache:arrivals:v3:${agencyKey}:${stopId}:${limit}:${after ?? 'now'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached)
      return JSON.parse(cached) as {
        data: ArrivalResponse[];
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
    if (!agRow) {
      throw new NotFoundException(`Agency not found for agencyKey: ${agencyKey}`);
    }
    const timezone = agRow.timezone;
    const agencyId: string = agRow.agencyId;

    // Resolve stop metadata and detect whether this is a parent station or a child
    // platform stop (e.g. 70067 — Alewife Outbound platform).
    // • Parent stations (e.g. place-asmnl) have no stop_times of their own; we use
    //   their children so arrivals from the whole station are shown.
    // • Child platform stops have a parent_station_id; we use ALL siblings so that
    //   both Inbound and Outbound tables are rendered for the station.
    const [stopInfo] = await this.dataSource.query<
      Array<{
        stop_name: string;
        parent_station_id: string | null;
        child_stop_ids: string[] | null;
      }>
    >(
      `SELECT s.stop_name,
              s.parent_station_id,
              ARRAY_AGG(c.stop_id) FILTER (WHERE c.stop_id IS NOT NULL) AS child_stop_ids
       FROM stops s
       LEFT JOIN stops c ON c.parent_station_id = s.stop_id AND c.agency_id = s.agency_id
       WHERE s.stop_id = $1 AND s.agency_id = $2
       GROUP BY s.stop_name, s.parent_station_id`,
      [stopId, agencyId],
    );
    const stopName: string = stopInfo?.stop_name ?? stopId;
    const childStopIds = stopInfo?.child_stop_ids;
    const parentStationId = stopInfo?.parent_station_id ?? null;

    let effectiveStopIds: string[];
    if (childStopIds && childStopIds.length > 0) {
      // This is a parent station — use its children.
      effectiveStopIds = childStopIds;
    } else if (parentStationId) {
      // This is a child platform stop — fetch all siblings from the same parent so
      // that arrivals in both directions are included.
      const siblingRows = await this.dataSource.query<Array<{ stop_id: string }>>(
        `SELECT stop_id FROM stops WHERE parent_station_id = $1 AND agency_id = $2`,
        [parentStationId, agencyId],
      );
      effectiveStopIds = siblingRows.length > 0 ? siblingRows.map((r) => r.stop_id) : [stopId];
    } else {
      // Standalone bus stop (no parent station). Find co-located stops — same name
      // within ~150m — so both inbound and outbound platforms are included.
      const neighborRows = await this.dataSource.query<Array<{ stop_id: string }>>(
        `SELECT stop_id FROM stops
         WHERE stop_name = $1
           AND agency_id = $2
           AND ST_DWithin(location::geography,
                          (SELECT location::geography FROM stops WHERE stop_id = $3 AND agency_id = $2 LIMIT 1),
                          150)`,
        [stopName, agencyId, stopId],
      );
      effectiveStopIds = neighborRows.length > 0 ? neighborRows.map((r) => r.stop_id) : [stopId];
    }

    // en-CA locale produces YYYY-MM-DD strings without JSON.stringify overhead
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const todayStr = dateFmt.format(new Date());
    const yesterdayStr = dateFmt.format(new Date(Date.now() - 86_400_000));

    // Parse 'after' param to a timestamp string in the agency's timezone, fallback to now
    let afterTimestamp: string;
    if (after) {
      const afterDate = new Date(after);
      if (!isNaN(afterDate.getTime())) {
        // Format as ISO string in UTC (Postgres expects this for timestamp comparison)
        afterTimestamp = afterDate.toISOString();
      } else {
        afterTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      }
    } else {
      // Default: 10 minutes before now
      afterTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    }

    const rows = await this.dataSource.query<Array<ArrivalRow>>(
      `WITH stop_slice AS MATERIALIZED (
         SELECT st.trip_id, st.agency_id, st.arrival_time, st.stop_id
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
      SELECT trip_id, route_id, short_name, long_name, trip_headsign, direction_id, arrival_time, stop_id
      FROM (
        SELECT DISTINCT ON (t.trip_id, ss.stop_id, ts.d)
          ss.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
          t.direction_id,
          ((ts.d + ss.arrival_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS arrival_time,
          ss.stop_id
        FROM stop_slice ss
        JOIN trips t         ON t.trip_id    = ss.trip_id    AND t.agency_id  = ss.agency_id
        JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
        JOIN routes r        ON r.route_id   = t.route_id    AND r.agency_id  = t.agency_id
        WHERE (ts.d + ss.arrival_time)::timestamp AT TIME ZONE $5 >= $6::timestamp
        ORDER BY t.trip_id, ss.stop_id, ts.d, (ts.d + ss.arrival_time)::timestamp AT TIME ZONE $5 ASC
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

    // Map: trip_id -> stop_id -> { arrivalTime, delay }
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
              // fallback: legacy value (delay as int)
              const delay = parseInt(val, 10);
              if (!isNaN(delay)) {
                realtimeMap.set(tripId, { legacy: { delay } });
              }
            }
          }
        });
      } catch {
        // Redis unavailable — fall back to scheduled-only arrivals
      }
    }

    // Build a set of all colocated stop IDs for this station
    const colocatedStopIdSet = new Set(effectiveStopIds);

    const data: ArrivalResponse[] = rows.map((row) => {
      const tripRealtime = realtimeMap.get(row.trip_id) ?? {};
      // Try to find realtime for this stop, or any colocated stop
      let stopRealtime = tripRealtime[row.stop_id] ?? null;
      if (!stopRealtime) {
        // Try all colocated stop IDs
        for (const altStopId of colocatedStopIdSet) {
          if (altStopId !== row.stop_id && tripRealtime[altStopId]) {
            stopRealtime = tripRealtime[altStopId];
            break;
          }
        }
      }
      let realtimeArrival: string = row.arrival_time; // fallback to scheduled
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

      const result = {
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
      return result;
    });

    // Merge unscheduled / ADDED realtime trips from Redis
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
              break; // one entry per trip
            }
          }
        }

        if (pendingAdded.length > 0) {
          const addedRouteIdList = [...addedRouteIds];

          // Fetch route metadata and representative headsigns per (route, direction)
          // for ADDED trips — the GTFS-RT feed never includes headsign on added trips.
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
               FROM trips
               WHERE agency_id = $1 AND route_id = ANY($2) AND trip_headsign IS NOT NULL
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
      // Redis unavailable or parse error — ADDED trips are best-effort
    }

    // Re-sort by effective arrival time (scheduled + delay) so realtime-advanced
    // arrivals are not buried behind later scheduled-order entries
    data.sort((a, b) => {
      // Sort by effective arrival time: realtimeArrival + delay (if present)
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
    if (cached) {
      return { data: JSON.parse(cached) };
    }

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

    const data = rows.map((r) => ({
      routeId: r.route_id,
      shortName: r.short_name,
      longName: r.long_name,
      routeType: r.route_type,
    }));
    // Cache for 24 hours (86400 seconds) since route/stop metadata is static
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

    // Resolve agency once if agencyKey is provided — avoids a JOIN in the geo
    // query and gives us the agencyId UUID + timezone needed for the batch arrival query.
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

    // Step 1: geo query — no correlated routes subquery; routes are batch-fetched
    // separately (same approach as search()) to avoid one plan-per-stop execution.
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
      }>
    >(
      `SELECT s.id, s.stop_id, s.stop_name, s.stop_code, s.wheelchair_boarding,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              ST_Distance(
                s.location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) AS distance_metres,
              s.agency_id
       FROM stops s
       WHERE ST_DWithin(
           s.location::geography,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           $3
         )
         ${agencyFilter}
       ORDER BY s.location::geography <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
       LIMIT $4`,
      queryParams,
    );

    // Step 2: batch-fetch routes for all returned stop IDs using the same indexed
    // CTE pattern as search() — one query replaces N correlated subqueries.
    const routesByStopId = new Map<string, StopRouteRef[]>();
    if (rows.length > 0) {
      const stopIdList = rows.map((r) => r.stop_id);
      const batchAgencyId = agencyId ?? rows[0].agency_id;
      const routeRows = await this.dataSource.query<
        Array<{
          group_stop_id: string;
          routeId: string;
          shortName: string | null;
          longName: string | null;
          routeType: number;
        }>
      >(
        `WITH expanded_stops AS MATERIALIZED (
           SELECT stop_id AS query_stop_id, stop_id AS effective_stop_id
           FROM stops WHERE stop_id = ANY($1) AND agency_id = $2
           UNION ALL
           SELECT parent_station_id AS query_stop_id, stop_id AS effective_stop_id
           FROM stops WHERE parent_station_id = ANY($1) AND agency_id = $2
         )
         SELECT DISTINCT
                es.query_stop_id  AS group_stop_id,
                r2.route_id       AS "routeId",
                r2.short_name     AS "shortName",
                r2.long_name      AS "longName",
                r2.route_type     AS "routeType"
         FROM expanded_stops es
         JOIN stop_times st2 ON st2.stop_id = es.effective_stop_id AND st2.agency_id = $2
         JOIN trips t2  ON t2.trip_id  = st2.trip_id  AND t2.agency_id  = st2.agency_id
         JOIN routes r2 ON r2.route_id = t2.route_id  AND r2.agency_id  = t2.agency_id
         ORDER BY group_stop_id, r2.short_name ASC`,
        [stopIdList, batchAgencyId],
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

    // Step 3: batch-fetch next arrival for all stops in one query instead of
    // N individual getArrivals() calls (which caused ~19 s cold-cache responses).
    let nextArrivalByStopId = new Map<string, ArrivalResponse>();
    if (agencyId && timezone && rows.length > 0) {
      nextArrivalByStopId = await this.batchGetNextArrivals(
        rows.map((r) => r.stop_id),
        params.agencyKey!,
        agencyId,
        timezone,
      );
    }

    // Build StopResponse array without nextArrival
    const stops: StopResponse[] = rows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      stopName: row.stop_name,
      stopCode: row.stop_code,
      lat: row.lat,
      lon: row.lon,
      distanceMetres: Math.round(row.distance_metres),
      routes: routesByStopId.get(row.stop_id) ?? [],
    }));

    // Merge colocated stops first
    const mergedStops = mergeColocatedStops(stops);

    // For each merged stop, find the earliest nextArrival among all original stops in the group
    const mergedData: (StopResponse & { nextArrival?: ArrivalResponse | null })[] = mergedStops.map(
      (merged) => {
        // Find all original stopIds that were merged into this stop
        const groupStopIds = stops
          .filter(
            (s) =>
              s.stopName === merged.stopName &&
              Math.sqrt((s.lat - merged.lat) ** 2 + (s.lon - merged.lon) ** 2) < 0.002 &&
              (s.routes ?? []).some((r) =>
                (merged.routes ?? []).some((mr) => mr.routeId === r.routeId),
              ),
          )
          .map((s) => s.stopId);
        // Find the earliest nextArrival among the group
        let bestArrival: ArrivalResponse | null = null;
        for (const stopId of groupStopIds) {
          const arr = nextArrivalByStopId.get(stopId) ?? null;
          if (arr) {
            const arrTime =
              new Date(arr.realtimeArrival).getTime() / 1000 + (arr.realtimeDelaySeconds ?? 0);
            const bestTime = bestArrival
              ? new Date(bestArrival.realtimeArrival).getTime() / 1000 +
                (bestArrival.realtimeDelaySeconds ?? 0)
              : Infinity;
            if (!bestArrival || arrTime < bestTime) {
              bestArrival = arr;
            }
          }
        }
        return { ...merged, nextArrival: bestArrival };
      },
    );

    const result = {
      data: mergedData,
      searchCentre: { lat: params.lat, lon: params.lon },
      radiusMetres: radius,
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_NEARBY_TTL_S);
    return result;
  }

  /**
   * Fetch the next scheduled arrival for each of the given stop IDs in a single
   * SQL round-trip. Parent stations are expanded to their child platform stops so
   * that arrivals are found even when the stop itself has no stop_times row.
   * Realtime delays are merged from Redis with a single HMGET call.
   */
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
      // LATERAL + LIMIT 1 lets PostgreSQL use idx_stop_times_agency_stop_dept for
      // an ascending index range scan per effective stop, stopping immediately when
      // the first future-service arrival is found. This replaces a MATERIALIZED
      // stop_slice CTE that cross-joined all stop_times with today_services
      // (25 k × 43 = 1 M rows) causing ~10 s cold-cache responses.
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

    // Merge realtime delays with one Redis round-trip for all trip IDs.
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
        // Redis unavailable — fall back to scheduled-only arrivals
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
