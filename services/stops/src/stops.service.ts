import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Stop,
  StopTime,
  Route,
  API_CACHE_ARRIVALS_TTL_S,
  API_CACHE_NEARBY_TTL_S,
  API_CACHE_SEARCH_TTL_S,
  ARRIVAL_PAST_GRACE_S,
  ARRIVALS_LATE_WINDOW_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
  activeServicesCte,
  addedTripsKey,
  candidateServiceDates,
  gtfsTimestampSql,
  tripRealtimeField,
  tripUpdatesFeedTsKey,
  tripUpdatesKey,
  type TripRealtime,
} from '@transit-tracker/shared';
import { CacheService } from './cache/cache.service';
import { reconcileAddedTrips } from './reconcileAddedTrips';
import {
  addedTripStopAt,
  mergeRealtime,
  parseTripRealtime,
  selectUpcoming,
  stopIdsNeedingParent,
  toArrivalResponse,
  type MergedArrival,
  type ScheduledRow,
} from './merge-realtime';
import {
  StopRouteRef,
  StopResponse,
  ArrivalResponse,
  ArrivalsResponse,
  AddedTripEntry,
} from './stops.types';

// ─── Shared SQL for scheduled stop_times ─────────────────────────────────────
// Placeholders are passed in because the two arrival queries number their
// parameters differently.

/** Scheduled arrival (else departure) as timestamptz; the time shown to riders. */
const scheduledTs = (tz: string) =>
  gtfsTimestampSql('ts.d', 'COALESCE(st.arrival_time, st.departure_time)', tz);

const scheduledColumns = (tz: string) => `
  st.trip_id, t.route_id, r.short_name, r.long_name, r.route_type, t.trip_headsign,
  t.direction_id, st.stop_id, s.parent_station_id, st.stop_sequence, st.pickup_type,
  to_char(ts.d, 'YYYYMMDD') AS service_date,
  EXTRACT(EPOCH FROM ${gtfsTimestampSql('ts.d', 'st.arrival_time', tz)})::float8 AS sched_arrival,
  EXTRACT(EPOCH FROM ${gtfsTimestampSql('ts.d', 'st.departure_time', tz)})::float8 AS sched_departure,
  ${scheduledTs(tz)} AS sched_ts`;

const scheduledJoins = `
  JOIN trips t           ON t.trip_id     = st.trip_id    AND t.agency_id  = st.agency_id
  JOIN today_services ts ON ts.service_id = t.service_id  AND ts.agency_id = t.agency_id
  JOIN routes r          ON r.route_id    = t.route_id    AND r.agency_id  = t.agency_id
  JOIN stops s           ON s.stop_id     = st.stop_id    AND s.agency_id  = st.agency_id`;

type ScheduledSqlRow = {
  trip_id: string;
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  route_type: number | null;
  trip_headsign: string | null;
  direction_id: number | null;
  stop_id: string;
  parent_station_id: string | null;
  stop_sequence: number;
  pickup_type: number | null;
  service_date: string;
  sched_arrival: number | null;
  sched_departure: number | null;
};

const toScheduledRow = (r: ScheduledSqlRow): ScheduledRow => ({
  tripId: r.trip_id,
  routeId: r.route_id,
  routeShortName: r.short_name,
  routeLongName: r.long_name,
  routeType: r.route_type,
  headsign: r.trip_headsign,
  directionId: r.direction_id ?? null,
  stopId: r.stop_id,
  parentStationId: r.parent_station_id || null,
  stopSequence: r.stop_sequence,
  serviceDate: r.service_date,
  scheduledArrival: r.sched_arrival,
  scheduledDeparture: r.sched_departure,
  pickupType: r.pickup_type,
});

const isoFromEpoch = (epochS: number) => new Date(epochS * 1000).toISOString();

// Upcoming scheduled rows fetched per platform for nearby. Leaves room for a
// few canceled, skipped or no-pickup rows ahead of the real next arrival.
const NEARBY_UPCOMING_PER_PLATFORM = 6;

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
      const row = stopRows[i];
      const gid = `${row.agency_id}:${row.colocated_group_id ?? rawData[i].stopId}`;
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
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_SEARCH_TTL_S);
    return result;
  }

  async getArrivals(
    stopId: string,
    agencyKey: string,
    limit = DEFAULT_SEARCH_LIMIT,
    after?: string,
  ): Promise<ArrivalsResponse> {
    const cappedLimit = Math.min(limit, MAX_SEARCH_LIMIT);
    const cacheKey = `cache:arrivals:v7:${agencyKey}:${stopId}:${cappedLimit}:${after ?? 'now'}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as ArrivalsResponse;

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
    // Parent station(s) the requested stop belongs to; realtime child
    // platforms (e.g. "Alewife-01") are matched through these.
    const stationIds = new Set<string>();
    if (parentStationId) {
      stationIds.add(parentStationId);
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
        stationIds.add(stopId);
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

    const { today: todayStr, yesterday: yesterdayStr } = candidateServiceDates(timezone);

    // Without `after`, look back ARRIVALS_LATE_WINDOW_S so trips running late
    // are still candidates; the merge drops the ones that have really gone.
    const nowS = Date.now() / 1000;
    const afterMs = after ? new Date(after).getTime() : NaN;
    const cutoffS = !isNaN(afterMs) ? afterMs / 1000 : nowS - ARRIVAL_PAST_GRACE_S;
    const windowStartS = !isNaN(afterMs) ? cutoffS : nowS - ARRIVALS_LATE_WINDOW_S;

    // Late candidates (scheduled before the cutoff) are bounded by the window.
    // Upcoming rows get a generous limit; the real limit is applied after the
    // realtime merge, since predictions can reorder them. Every visit is kept
    // (loop routes stop here twice); selectUpcoming keeps each trip's next one.
    const sqlRows = await this.dataSource.query<ScheduledSqlRow[]>(
      `WITH ${activeServicesCte('$2', ['$3', '$4'])},
       candidates AS (
         SELECT ${scheduledColumns('$5')}
         FROM stop_times st
         ${scheduledJoins}
         WHERE st.stop_id = ANY($1) AND st.agency_id = $2
           AND ${scheduledTs('$5')} >= $6::timestamptz
       )
       (SELECT * FROM candidates WHERE sched_ts < $7::timestamptz)
       UNION ALL
       (SELECT * FROM candidates WHERE sched_ts >= $7::timestamptz ORDER BY sched_ts ASC LIMIT $8)`,
      [
        effectiveStopIds,
        agencyId,
        todayStr,
        yesterdayStr,
        timezone,
        isoFromEpoch(windowStartS),
        isoFromEpoch(cutoffS),
        cappedLimit * 3,
      ],
    );
    const rows = sqlRows.map(toScheduledRow);

    const [realtimeByTrip, addedTrips, lastFeedTimestamp] = await Promise.all([
      this.loadTripRealtime(agencyKey, rows),
      this.loadAddedTrips(agencyKey),
      this.loadLastFeedTimestamp(agencyKey),
    ]);

    const effectiveStopIdSet = new Set(effectiveStopIds);
    const parentOf = await this.loadParentStations(agencyId, [
      ...stopIdsNeedingParent(realtimeByTrip.values()),
      ...addedTrips.flatMap((t) =>
        t.stops
          .map((s) => s.stopId)
          .filter((id): id is string => !!id && !effectiveStopIdSet.has(id)),
      ),
    ]);

    const merged = mergeRealtime(rows, realtimeByTrip, parentOf);

    const pendingAdded = addedTrips.flatMap((trip) => {
      const at = addedTripStopAt(trip, effectiveStopIdSet, stationIds, parentOf, cutoffS);
      return at ? [{ trip, ...at }] : [];
    });
    reconcileAddedTrips(merged, await this.buildAddedEntries(agencyId, pendingAdded));

    const data = selectUpcoming(merged, cutoffS, cappedLimit).map(toArrivalResponse);

    const result: ArrivalsResponse = {
      data,
      stopId,
      agencyKey,
      stopName,
      timezone,
      feedTimestamp: lastFeedTimestamp,
    };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ARRIVALS_TTL_S);
    return result;
  }

  /** Looks up route names and headsigns for ADDED trips boarding at a stop. */
  private async buildAddedEntries(
    agencyId: string,
    pendingAdded: Array<{
      trip: TripRealtime;
      predictedTime: number;
      leavesAt: number;
      uncertainty: number | null;
    }>,
  ): Promise<AddedTripEntry[]> {
    if (pendingAdded.length === 0) return [];
    const addedRouteIdList = [...new Set(pendingAdded.map(({ trip }) => trip.routeId!))];
    const [routeRows, headsignRows] = await Promise.all([
      this.dataSource.query<
        Array<{
          route_id: string;
          short_name: string | null;
          long_name: string | null;
          route_type: number;
        }>
      >(
        `SELECT route_id, short_name, long_name, route_type FROM routes WHERE agency_id = $1 AND route_id = ANY($2)`,
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

    return pendingAdded.map(({ trip, predictedTime, leavesAt, uncertainty }) => {
      const route = routeMap.get(trip.routeId!);
      return {
        trip: {
          tripId: trip.tripId,
          routeId: trip.routeId!,
          directionId: trip.directionId,
          headsign: null,
        },
        predictedTime,
        leavesAt,
        uncertaintySeconds: uncertainty,
        routeType: route?.route_type ?? null,
        routeShortName: route?.short_name ?? null,
        routeLongName: route?.long_name ?? null,
        headsignFallback: headsignMap.get(`${trip.routeId}|${trip.directionId}`) ?? null,
      };
    });
  }

  /**
   * Reads trip_updates:v2 for the given rows, by trip_id + service date and by
   * bare trip_id (feeds without a start date). Keyed by hash field, as
   * mergeRealtime expects. Missing or malformed entries are skipped.
   */
  private async loadTripRealtime(
    agencyKey: string,
    rows: ScheduledRow[],
  ): Promise<Map<string, TripRealtime>> {
    const result = new Map<string, TripRealtime>();
    const fields = [
      ...new Set(rows.flatMap((r) => [tripRealtimeField(r.tripId, r.serviceDate), r.tripId])),
    ];
    if (fields.length === 0) return result;
    try {
      const values = await this.cacheService
        .getClient()
        .hmget(tripUpdatesKey(agencyKey), ...fields);
      fields.forEach((field, i) => {
        const trip = parseTripRealtime(values[i]);
        if (trip) result.set(field, trip);
      });
    } catch {
      /* Redis unavailable — fall back to the schedule */
    }
    return result;
  }

  /**
   * When the worker last wrote a TripUpdates feed (epoch s). Kept well past
   * the predictions' TTL, so a stalled worker reads as stale, not as "no
   * data". Null if no feed was written in the last day or Redis is down.
   */
  private async loadLastFeedTimestamp(agencyKey: string): Promise<number | null> {
    try {
      const raw = await this.cacheService.getClient().get(tripUpdatesFeedTsKey(agencyKey));
      const ts = raw === null ? NaN : Number(raw);
      return Number.isFinite(ts) ? ts : null;
    } catch {
      return null;
    }
  }

  /** Reads added_trips:v2. Trips without a route can't be placed and are skipped. */
  private async loadAddedTrips(agencyKey: string): Promise<TripRealtime[]> {
    try {
      const raw = await this.cacheService.getClient().hgetall(addedTripsKey(agencyKey));
      return Object.values(raw ?? {})
        .map(parseTripRealtime)
        .filter((t): t is TripRealtime => t !== null && !!t.routeId);
    } catch {
      return [];
    }
  }

  private async loadParentStations(
    agencyId: string,
    stopIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(stopIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.query<Array<{ stop_id: string; parent_station_id: string }>>(
      `SELECT stop_id, parent_station_id FROM stops
       WHERE agency_id = $1 AND stop_id = ANY($2) AND parent_station_id IS NOT NULL AND parent_station_id != ''`,
      [agencyId, unique],
    );
    return new Map(rows.map((r) => [r.stop_id, r.parent_station_id]));
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
      const matchingRow = rows.find((r) => r.stop_id === s.stopId);
      const gid = matchingRow
        ? `${matchingRow.agency_id}:${matchingRow.colocated_group_id ?? s.stopId}`
        : s.stopId;
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

      // realtimeArrival is already the effective (predicted, else scheduled) time.
      let bestArrival: ArrivalResponse | null = null;
      for (const s of group) {
        const arr = nextArrivalByStopId.get(s.stopId) ?? null;
        if (
          arr &&
          (!bestArrival ||
            new Date(arr.realtimeArrival).getTime() <
              new Date(bestArrival.realtimeArrival).getTime())
        ) {
          bestArrival = arr;
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
    const { today: todayStr, yesterday: yesterdayStr } = candidateServiceDates(timezone);
    const nowS = Date.now() / 1000;
    const cutoffS = nowS - ARRIVAL_PAST_GRACE_S;

    // Per platform: the most recent trips scheduled in the late window (they
    // may still be coming) plus the next few scheduled ones. Same merge rules
    // as getArrivals.
    const sqlRows = await this.dataSource.query<Array<ScheduledSqlRow & { group_stop_id: string }>>(
      `WITH ${activeServicesCte('$2', ['$3', '$4'])},
       expanded_stops AS MATERIALIZED (
         SELECT stop_id AS parent_stop_id, stop_id AS effective_stop_id
         FROM stops WHERE stop_id = ANY($1) AND agency_id = $2
         UNION ALL
         SELECT parent_station_id AS parent_stop_id, stop_id AS effective_stop_id
         FROM stops WHERE parent_station_id = ANY($1) AND agency_id = $2
       )
       SELECT es.parent_stop_id AS group_stop_id, dep.*
       FROM expanded_stops es
       CROSS JOIN LATERAL (
         (SELECT ${scheduledColumns('$5')}
          FROM stop_times st
          ${scheduledJoins}
          WHERE st.stop_id = es.effective_stop_id AND st.agency_id = $2
            AND ${scheduledTs('$5')} >= $6::timestamptz
            AND ${scheduledTs('$5')} < $7::timestamptz
          ORDER BY sched_ts DESC
          LIMIT 10)
         UNION ALL
         (SELECT ${scheduledColumns('$5')}
          FROM stop_times st
          ${scheduledJoins}
          WHERE st.stop_id = es.effective_stop_id AND st.agency_id = $2
            AND ${scheduledTs('$5')} >= $7::timestamptz
          ORDER BY sched_ts ASC
          LIMIT $8)
       ) dep`,
      [
        stopIds,
        agencyId,
        todayStr,
        yesterdayStr,
        timezone,
        isoFromEpoch(nowS - ARRIVALS_LATE_WINDOW_S),
        isoFromEpoch(cutoffS),
        NEARBY_UPCOMING_PER_PLATFORM,
      ],
    );

    const rows = sqlRows.map(toScheduledRow);
    const [realtimeByTrip, addedTrips] = await Promise.all([
      this.loadTripRealtime(agencyKey, rows),
      this.loadAddedTrips(agencyKey),
    ]);
    const parentOf = await this.loadParentStations(agencyId, [
      ...stopIdsNeedingParent(realtimeByTrip.values()),
      ...addedTrips.flatMap((t) => t.stops.map((s) => s.stopId).filter((id): id is string => !!id)),
    ]);
    const merged = mergeRealtime(rows, realtimeByTrip, parentOf);

    const byGroup = new Map<string, MergedArrival[]>(stopIds.map((id) => [id, []]));
    const platformsByGroup = new Map<string, Set<string>>(stopIds.map((id) => [id, new Set([id])]));
    sqlRows.forEach((row, i) => {
      byGroup.get(row.group_stop_id)?.push(merged[i]);
      platformsByGroup.get(row.group_stop_id)?.add(row.stop_id);
    });

    // ADDED trips, placed and reconciled per stop exactly as in getArrivals.
    // The group's own id is passed as a station, so a parent station's child
    // platforms match through parentOf.
    const pendingAdded = [...byGroup.keys()].flatMap((groupStopId) =>
      addedTrips.flatMap((trip) => {
        const at = addedTripStopAt(
          trip,
          platformsByGroup.get(groupStopId)!,
          new Set([groupStopId]),
          parentOf,
          cutoffS,
        );
        return at ? [{ groupStopId, trip, ...at }] : [];
      }),
    );
    const addedEntries = await this.buildAddedEntries(agencyId, pendingAdded);
    for (const groupStopId of byGroup.keys()) {
      const entries = addedEntries.filter((_, i) => pendingAdded[i].groupStopId === groupStopId);
      if (entries.length > 0) reconcileAddedTrips(byGroup.get(groupStopId)!, entries);
    }

    const result = new Map<string, ArrivalResponse>();
    for (const [groupStopId, arrivals] of byGroup) {
      const [next] = selectUpcoming(arrivals, cutoffS, 1);
      if (next) result.set(groupStopId, toArrivalResponse(next));
    }
    return result;
  }
}
