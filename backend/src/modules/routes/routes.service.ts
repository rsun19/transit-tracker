import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Route } from './entities/route.entity';
import { Shape } from '@/modules/ingestion/entities/shape.entity';
import { CacheService } from '@/modules/cache/cache.service';
import { API_CACHE_ROUTES_TTL_S, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from '@/common/constants';

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteStopResponse {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  stopSequence: number;
}

export interface RouteBranch {
  label: string;
  directionId: number;
  stops: RouteStopResponse[];
}

export interface RouteResponse {
  id: string;
  agencyKey?: string;
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
  color: string | null;
  textColor: string | null;
  stops?: RouteStopResponse[];
  branches?: RouteBranch[];
}

@Injectable()
export class RoutesService {
  constructor(
    @InjectRepository(Route) private readonly routeRepo: Repository<Route>,
    @InjectRepository(Shape) private readonly shapeRepo: Repository<Shape>,
    private readonly cacheService: CacheService,
  ) {}

  async findAll(params: {
    agencyKey?: string;
    routeType?: number;
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: RouteResponse[]; total: number }> {
    const limit = Math.min(params.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const offset = params.offset ?? 0;

    const cacheKey = `cache:routes:v2:${params.agencyKey ?? 'all'}:${params.routeType ?? ''}:${params.q ?? ''}:${limit}:${offset}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as { data: RouteResponse[]; total: number };

    const qb = this.routeRepo.createQueryBuilder('r').leftJoin('r.agency', 'a');

    if (params.agencyKey) qb.andWhere('a.agency_key = :agencyKey', { agencyKey: params.agencyKey });
    if (params.routeType !== undefined)
      qb.andWhere('r.route_type = :routeType', { routeType: params.routeType });
    if (params.q) {
      qb.andWhere('(r.short_name ILIKE :q OR r.long_name ILIKE :q)', { q: `%${params.q}%` });
    }

    // Exclude shuttle routes that have no stop_times (i.e. not currently operating).
    // Shuttles with active service are kept so riders can see them when running.
    qb.andWhere(
      `(
        (r.short_name NOT ILIKE '%shuttle%' AND r.long_name NOT ILIKE '%shuttle%')
        OR EXISTS (
          SELECT 1 FROM trips t
          JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
          WHERE t.route_id = r.route_id AND t.agency_id = r.agency_id
        )
      )`,
    );

    // Sort by mode priority (subway first, then tram/light-rail, commuter rail, ferry, bus)
    // so the most-used transit modes always appear at the top of the list regardless of name.
    // GTFS route_type: 1=Subway 0=Tram 2=Rail 4=Ferry 3=Bus
    const [routes, total] = await qb
      .addSelect(
        `CASE r.route_type WHEN 1 THEN 0 WHEN 0 THEN 1 WHEN 2 THEN 2 WHEN 4 THEN 3 ELSE 4 END`,
        'type_priority',
      )
      .orderBy('type_priority', 'ASC')
      .addOrderBy('r.longName', 'ASC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const result = {
      data: routes.map((r) => this.toResponse(r)),
      total,
    };

    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ROUTES_TTL_S);
    return result;
  }

  async findOne(routeId: string, agencyKey: string): Promise<RouteResponse> {
    const cacheKey = `cache:route:v4:${agencyKey}:${routeId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as RouteResponse;

    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();

    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    // Find one representative trip per (direction_id, headsign) combination, choosing
    // the trip with the most stops. This correctly handles branching routes (e.g. Red
    // Line: Ashmont and Braintree) as well as routes whose inbound/outbound headsigns
    // differ (e.g. route 713: three distinct destinations across both directions).
    const branchReps = await this.routeRepo.query<
      Array<{
        trip_id: string;
        direction_id: number;
        shape_id: string | null;
        trip_headsign: string | null;
        stop_count: string;
      }>
    >(
      `WITH trip_stop_counts AS (
         SELECT t.trip_id, t.direction_id, t.trip_headsign, t.shape_id,
                COUNT(st.stop_id)::int AS stop_count
         FROM trips t
         JOIN agencies a ON a."agencyId" = t.agency_id
         JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
         WHERE t.route_id = $1 AND a.agency_key = $2
         GROUP BY t.trip_id, t.direction_id, t.trip_headsign, t.shape_id
       )
       SELECT DISTINCT ON (direction_id, trip_headsign)
              trip_id, direction_id, shape_id, trip_headsign, stop_count
       FROM trip_stop_counts
       ORDER BY direction_id, trip_headsign, stop_count DESC`,
      [routeId, agencyKey],
    );

    // For routes with no outbound trips (shouldn't happen, but guard anyway)
    if (branchReps.length === 0) throw new NotFoundException(`Route ${routeId} not found`);

    // Fetch stops for every branch in one batched query, then split by trip_id
    const branchTripIds = branchReps.map((b) => b.trip_id);
    const agencyId = route.agencyId;
    const allStopRows = await this.routeRepo.query<Array<RouteStopResponse & { trip_id: string }>>(
      `SELECT st.trip_id,
              s.stop_id AS "stopId",
              s.stop_name AS "stopName",
              ST_Y(s.location::geometry) AS latitude,
              ST_X(s.location::geometry) AS longitude,
              st.stop_sequence AS "stopSequence"
       FROM stop_times st
       JOIN stops s ON s.stop_id = st.stop_id AND s.agency_id = st.agency_id
       WHERE st.trip_id = ANY($1) AND st.agency_id = $2
       ORDER BY st.trip_id, st.stop_sequence ASC`,
      [branchTripIds, agencyId],
    );

    // Group fetched stops back to their branch trip
    const stopsByTripId = new Map<string, RouteStopResponse[]>();
    for (const row of allStopRows) {
      const { trip_id, ...stop } = row;
      if (!stopsByTripId.has(trip_id)) stopsByTripId.set(trip_id, []);
      stopsByTripId.get(trip_id)!.push(stop);
    }

    // Sort branches by stop count DESC (longest/most-complete branch first)
    const sortedBranches = [...branchReps].sort(
      (a, b) => parseInt(b.stop_count) - parseInt(a.stop_count),
    );

    const branches: RouteBranch[] = sortedBranches.map((b) => ({
      label: b.trip_headsign ?? routeId,
      directionId: b.direction_id,
      stops: stopsByTripId.get(b.trip_id) ?? [],
    }));

    // Use the longest branch's stops as the flat `stops` field (backward compat)
    const stops = branches[0]?.stops ?? [];

    const result: RouteResponse = { ...this.toResponse(route), stops, branches };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ROUTES_TTL_S);
    return result;
  }

  async getShape(routeId: string, agencyKey: string): Promise<GeoJsonLineString | null> {
    // Find the longest branch's shape for this route (same logic as findOne, but only shape)
    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();
    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    // Find the trip with the most stops for this route (any direction/branch)
    const branchRep = await this.routeRepo.query<
      Array<{ shape_id: string | null; stop_count: string }>
    >(
      `SELECT t.shape_id, COUNT(st.stop_id)::int AS stop_count
       FROM trips t
       JOIN agencies a ON a."agencyId" = t.agency_id
       JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
       WHERE t.route_id = $1 AND a.agency_key = $2
       GROUP BY t.shape_id
       ORDER BY stop_count DESC
       LIMIT 1`,
      [routeId, agencyKey],
    );
    const shapeId = branchRep[0]?.shape_id ?? null;
    if (!shapeId) return null;

    const shapePoints = await this.shapeRepo
      .createQueryBuilder('s')
      .leftJoin('s.agency', 'a')
      .where('s.shape_id = :shapeId', { shapeId })
      .andWhere('a.agency_key = :agencyKey', { agencyKey })
      .orderBy('s.ptSequence', 'ASC')
      .getMany();

    if (shapePoints.length < 2) return null;
    const coords = shapePoints.map((p) => {
      const location = p.location as unknown;
      if (
        location &&
        typeof location === 'object' &&
        'coordinates' in (location as Record<string, unknown>)
      ) {
        const coordinates = (location as { coordinates?: unknown }).coordinates;
        if (
          Array.isArray(coordinates) &&
          coordinates.length >= 2 &&
          typeof coordinates[0] === 'number' &&
          typeof coordinates[1] === 'number'
        ) {
          return [coordinates[0], coordinates[1]] as [number, number];
        }
      }
      const match = String(location).match(/POINT\(([^ ]+) ([^ )]+)\)/);
      return match
        ? ([parseFloat(match[1]), parseFloat(match[2])] as [number, number])
        : ([0, 0] as [number, number]);
    });
    return { type: 'LineString', coordinates: coords };
  }

  private toResponse(route: Route): RouteResponse {
    return {
      id: route.id,
      routeId: route.routeId,
      shortName: route.shortName,
      longName: route.longName,
      routeType: route.routeType,
      color: route.color,
      textColor: route.textColor,
    };
  }
}
