import { Injectable, NotFoundException } from '@nestjs/common';
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

export interface AddedTripEntry {
  trip: {
    tripId: string;
    routeId: string;
    directionId: number | null;
    headsign: string | null;
  };
  departureTime: number; // Unix seconds
  routeShortName: string | null;
  routeLongName: string | null;
  headsignFallback: string | null;
}

/** Maximum window (ms) within which an ADDED trip is matched to a scheduled slot. */
export const RECONCILE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Reconcile ADDED/unscheduled realtime trips against a list of scheduled departures.
 *
 * Many agencies (including MBTA) publish realtime predictions for scheduled trips
 * under opaque ADDED-xxx trip IDs. This function:
 *  1. Sorts ADDED entries by departure time ascending so high-frequency routes are
 *     matched correctly (earlier trains claim their slot first).
 *  2. For each ADDED entry, finds the nearest unmatched scheduled trip for the same
 *     routeId + directionId within RECONCILE_WINDOW_MS.
 *  3a. Match found → merges realtime delay into the scheduled row (mutates in place).
 *  3b. No match → appends the ADDED entry as genuinely new extra service.
 *
 * Mutates `departures` in place and returns it for convenience.
 */
export function reconcileAddedTrips(
  departures: DepartureResponse[],
  addedEntries: AddedTripEntry[],
): DepartureResponse[] {
  const sorted = [...addedEntries].sort((a, b) => a.departureTime - b.departureTime);
  const reconciledIndices = new Set<number>();

  for (const entry of sorted) {
    const addedMs = entry.departureTime * 1000;

    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < departures.length; i++) {
      if (reconciledIndices.has(i)) continue;
      const dep = departures[i];
      if (dep.routeId !== entry.trip.routeId) continue;
      if (dep.directionId !== entry.trip.directionId) continue;
      const diff = Math.abs(addedMs - new Date(dep.scheduledDeparture).getTime());
      if (diff < bestDiff && diff <= RECONCILE_WINDOW_MS) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      reconciledIndices.add(bestIdx);
      const schedMs = new Date(departures[bestIdx].scheduledDeparture).getTime();
      departures[bestIdx].realtimeDelaySeconds = Math.round((addedMs - schedMs) / 1000);
      departures[bestIdx].hasRealtime = true;
      if (!departures[bestIdx].headsign) {
        departures[bestIdx].headsign = entry.trip.headsign ?? entry.headsignFallback;
      }
    } else {
      departures.push({
        tripId: entry.trip.tripId,
        routeId: entry.trip.routeId,
        routeShortName: entry.routeShortName,
        routeLongName: entry.routeLongName,
        headsign: entry.trip.headsign ?? entry.headsignFallback,
        scheduledDeparture: new Date(addedMs).toISOString(),
        realtimeDelaySeconds: 0,
        hasRealtime: true,
        directionId: entry.trip.directionId,
      });
      // Prevent subsequent ADDED entries from matching this newly-pushed row.
      reconciledIndices.add(departures.length - 1);
    }
  }

  return departures;
}

/** Radius in degrees used to consider two bus stops as co-located (~150 m). */
export const STOP_MERGE_RADIUS_DEG = 150 / 111_320;

/**
 * Merge co-located bus stops in a search result list.
 *
 * Two stops are merged when they share the same `stopName`, are within
 * `STOP_MERGE_RADIUS_DEG` of each other, AND share at least one route.
 * The first stop in each group is kept as the canonical entry; its route list
 * becomes the union of all merged stops' routes (deduped by routeId).
 */
export function mergeColocatedStops(stops: StopResponse[]): StopResponse[] {
  const merged: StopResponse[] = [];
  const consumed = new Set<string>();

  for (const stop of stops) {
    if (consumed.has(stop.stopId)) continue;
    const stopRouteIds = new Set((stop.routes ?? []).map((r) => r.routeId));

    const group = stops.filter((other) => {
      if (other.stopId === stop.stopId) return true;
      if (consumed.has(other.stopId)) return false;
      if (other.stopName !== stop.stopName) return false;
      const dLat = other.lat - stop.lat;
      const dLon = other.lon - stop.lon;
      if (Math.sqrt(dLat * dLat + dLon * dLon) > STOP_MERGE_RADIUS_DEG) return false;
      return (other.routes ?? []).some((r) => stopRouteIds.has(r.routeId));
    });

    const seenRouteIds = new Set<string>();
    const mergedRoutes: StopRouteRef[] = [];
    for (const g of group) {
      for (const r of g.routes ?? []) {
        if (!seenRouteIds.has(r.routeId)) {
          seenRouteIds.add(r.routeId);
          mergedRoutes.push(r);
        }
      }
    }
    mergedRoutes.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? ''));
    for (const g of group) consumed.add(g.stopId);
    merged.push({ ...stop, routes: mergedRoutes });
  }

  return merged;
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
      wheelchairBoarding: row.wheelchair_boarding,
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
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_DEPARTURES_TTL_S);
    return result;
  }

  async getDepartures(
    stopId: string,
    agencyKey: string,
    limit = DEFAULT_SEARCH_LIMIT,
    after?: string,
  ): Promise<{ data: DepartureResponse[]; stopId: string; agencyKey: string; stopName: string }> {
    const cacheKey = `cache:departures:v3:${agencyKey}:${stopId}:${limit}:${after ?? 'now'}`;
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
    if (!agRow) {
      throw new NotFoundException(`Agency not found for agencyKey: ${agencyKey}`);
    }
    const timezone = agRow.timezone;
    const agencyId: string = agRow.agencyId;

    // Resolve stop metadata and detect whether this is a parent station or a child
    // platform stop (e.g. 70067 — Alewife Outbound platform).
    // • Parent stations (e.g. place-asmnl) have no stop_times of their own; we use
    //   their children so departures from the whole station are shown.
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
      // that departures in both directions are included.
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
       -- Deduplicate: a trip can appear in stop_slice multiple times when effectiveStopIds
       -- contains several platforms it serves (e.g. colocated inbound/outbound bus stops).
       -- The subquery picks the earliest departure for each (trip_id, service_date) pair,
       -- then the outer query re-sorts and applies the limit.
       SELECT trip_id, route_id, short_name, long_name, trip_headsign, direction_id, departure_time
       FROM (
         SELECT DISTINCT ON (t.trip_id, ts.d)
                ss.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
                t.direction_id,
                ((ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS departure_time
         FROM stop_slice ss
         JOIN trips t         ON t.trip_id    = ss.trip_id    AND t.agency_id  = ss.agency_id
         JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
         JOIN routes r        ON r.route_id   = t.route_id    AND r.agency_id  = t.agency_id
         WHERE (ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 >= NOW()
         ORDER BY t.trip_id, ts.d, (ts.d + ss.departure_time)::timestamp AT TIME ZONE $5 ASC
       ) deduped
       ORDER BY departure_time ASC
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

    // Look up realtime delays for all returned trips in one Redis HMGET round-trip.
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
        // Redis unavailable — fall back to scheduled-only departures
      }
    }

    const data: DepartureResponse[] = rows.map((row) => {
      const delay = delayMap.get(row.trip_id) ?? null;
      return {
        tripId: row.trip_id,
        routeId: row.route_id,
        routeShortName: row.short_name,
        routeLongName: row.long_name,
        headsign: row.trip_headsign,
        scheduledDeparture: row.departure_time,
        realtimeDelaySeconds: delay,
        hasRealtime: delay !== null,
        directionId: row.direction_id ?? null,
      };
    });

    // Merge unscheduled / ADDED realtime trips from Redis
    type AddedStop = { stopId: string; departureTime: number };
    type AddedTrip = {
      tripId: string;
      routeId: string;
      directionId: number | null;
      headsign: string | null;
      stops: AddedStop[];
    };
    try {
      const redis = this.cacheService.getClient();
      const addedRaw = await redis.hgetall(`added_trips:${agencyKey}`);
      if (addedRaw && Object.keys(addedRaw).length > 0) {
        const nowMs = Date.now();
        const effectiveStopIdSet = new Set(effectiveStopIds);
        const pendingAdded: Array<{ trip: AddedTrip; departureTime: number }> = [];
        const addedRouteIds = new Set<string>();

        for (const raw of Object.values(addedRaw)) {
          const trip = JSON.parse(raw) as AddedTrip;
          for (const stop of trip.stops) {
            if (effectiveStopIdSet.has(stop.stopId) && stop.departureTime * 1000 > nowMs) {
              addedRouteIds.add(trip.routeId);
              pendingAdded.push({ trip, departureTime: stop.departureTime });
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

          const entries: AddedTripEntry[] = pendingAdded.map(({ trip, departureTime }) => ({
            trip,
            departureTime,
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

    // Re-sort by effective departure time (scheduled + delay) so realtime-advanced
    // arrivals are not buried behind later scheduled-order entries
    data.sort((a, b) => {
      const aEff = new Date(a.scheduledDeparture).getTime() + (a.realtimeDelaySeconds ?? 0) * 1000;
      const bEff = new Date(b.scheduledDeparture).getTime() + (b.realtimeDelaySeconds ?? 0) * 1000;
      return aEff - bEff;
    });

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

    // Resolve agency once if agencyKey is provided — avoids a JOIN in the geo
    // query and gives us the agencyId UUID + timezone needed for the batch departure query.
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

    // Step 3: batch-fetch next departure for all stops in one query instead of
    // N individual getDepartures() calls (which caused ~19 s cold-cache responses).
    let nextDepartureByStopId = new Map<string, DepartureResponse>();
    if (agencyId && timezone && rows.length > 0) {
      nextDepartureByStopId = await this.batchGetNextDepartures(
        rows.map((r) => r.stop_id),
        params.agencyKey!,
        agencyId,
        timezone,
      );
    }

    const data: (StopResponse & { nextDeparture?: DepartureResponse | null })[] = rows.map(
      (row) => {
        const stop: StopResponse & { nextDeparture?: DepartureResponse | null } = {
          id: row.id,
          stopId: row.stop_id,
          stopName: row.stop_name,
          stopCode: row.stop_code,
          lat: row.lat,
          lon: row.lon,
          wheelchairBoarding: row.wheelchair_boarding,
          distanceMetres: Math.round(row.distance_metres),
          routes: routesByStopId.get(row.stop_id) ?? [],
        };
        if (params.agencyKey !== undefined) {
          stop.nextDeparture = nextDepartureByStopId.get(row.stop_id) ?? null;
        }
        return stop;
      },
    );

    const result = {
      data: mergeColocatedStops(data) as (StopResponse & {
        nextDeparture?: DepartureResponse | null;
      })[],
      searchCentre: { lat: params.lat, lon: params.lon },
      radiusMetres: radius,
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_NEARBY_TTL_S);
    return result;
  }

  /**
   * Fetch the next scheduled departure for each of the given stop IDs in a single
   * SQL round-trip. Parent stations are expanded to their child platform stops so
   * that departures are found even when the stop itself has no stop_times row.
   * Realtime delays are merged from Redis with a single HMGET call.
   */
  private async batchGetNextDepartures(
    stopIds: string[],
    agencyKey: string,
    agencyId: string,
    timezone: string,
  ): Promise<Map<string, DepartureResponse>> {
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
        departure_time: string;
        direction_id: number | null;
      }>
    >(
      // LATERAL + LIMIT 1 lets PostgreSQL use idx_stop_times_agency_stop_dept for
      // an ascending index range scan per effective stop, stopping immediately when
      // the first future-service departure is found. This replaces a MATERIALIZED
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
              dep.trip_headsign, dep.direction_id, dep.departure_time
       FROM expanded_stops es
       LEFT JOIN LATERAL (
         SELECT st.trip_id, t.route_id, r.short_name, r.long_name, t.trip_headsign,
                t.direction_id,
                ((ts.d + st.departure_time)::timestamp AT TIME ZONE $5 AT TIME ZONE 'UTC')::text || 'Z' AS departure_time,
                (ts.d + st.departure_time)::timestamp AT TIME ZONE $5 AS eff_ts
         FROM stop_times st
         JOIN trips t         ON t.trip_id    = st.trip_id  AND t.agency_id = st.agency_id
         JOIN today_services ts ON ts.service_id = t.service_id AND ts.agency_id = t.agency_id
         JOIN routes r        ON r.route_id   = t.route_id  AND r.agency_id  = t.agency_id
         WHERE st.stop_id = es.effective_stop_id AND st.agency_id = $2
           AND (ts.d + st.departure_time)::timestamp AT TIME ZONE $5 >= NOW()
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
        // Redis unavailable — fall back to scheduled-only departures
      }
    }

    const result = new Map<string, DepartureResponse>();
    for (const row of rows) {
      const delay = delayMap.get(row.trip_id) ?? null;
      result.set(row.stop_id, {
        tripId: row.trip_id,
        routeId: row.route_id,
        routeShortName: row.short_name,
        routeLongName: row.long_name,
        headsign: row.trip_headsign,
        scheduledDeparture: row.departure_time,
        realtimeDelaySeconds: delay,
        hasRealtime: delay !== null,
        directionId: row.direction_id ?? null,
      });
    }
    return result;
  }
}
