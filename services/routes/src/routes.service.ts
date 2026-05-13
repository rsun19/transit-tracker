import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Route,
  Shape,
  API_CACHE_ROUTES_TTL_S,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from '@transit-tracker/shared';
import { CacheService } from './cache/cache.service';

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

    qb.andWhere(
      `(
        (r.short_name NOT ILIKE '%shuttle%' AND r.long_name NOT ILIKE '%shuttle%')
        OR r.has_stop_times = true
      )`,
    );

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
    const cacheKey = `cache:route:v5:${agencyKey}:${routeId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as RouteResponse;

    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();

    if (!route) throw new NotFoundException(`Route ${routeId} not found`);
    const agencyId = route.agencyId;

    // Fetch precomputed route branches — one representative trip per
    // (direction_id, headsign) chosen during ingestion by stop count DESC.
    let branchReps = await this.routeRepo.query<
      Array<{
        trip_id: string;
        direction_id: number;
        shape_id: string | null;
        trip_headsign: string | null;
        stop_count: string;
      }>
    >(
      `SELECT trip_id, direction_id, trip_headsign, shape_id, stop_count
       FROM route_branches
       WHERE route_id = $1 AND agency_id = $2
       ORDER BY stop_count DESC`,
      [routeId, agencyId],
    );

    // Fallback when route_branches table is empty (e.g. before first ingestion)
    if (branchReps.length === 0) {
      branchReps = await this.routeRepo.query<
        Array<{
          trip_id: string;
          direction_id: number;
          shape_id: string | null;
          trip_headsign: string | null;
          stop_count: string;
        }>
      >(
        `SELECT DISTINCT ON (t.direction_id, t.trip_headsign)
                t.trip_id, t.direction_id, t.trip_headsign, t.shape_id,
                COUNT(st.stop_id)::int AS stop_count
         FROM trips t
         JOIN stop_times st ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
         WHERE t.route_id = $1 AND t.agency_id = $2
         GROUP BY t.trip_id, t.direction_id, t.trip_headsign, t.shape_id
         ORDER BY t.direction_id, t.trip_headsign, stop_count DESC`,
        [routeId, agencyId],
      );
    }

    if (branchReps.length === 0) throw new NotFoundException(`Route ${routeId} not found`);

    const branchTripIds = branchReps.map((b) => b.trip_id);
    const allStopRows = await this.routeRepo.query<Array<RouteStopResponse & { trip_id: string }>>(
      `SELECT DISTINCT ON (st.trip_id, st.stop_sequence)
              st.trip_id,
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

    const stopsByTripId = new Map<string, RouteStopResponse[]>();
    for (const row of allStopRows) {
      const { trip_id, ...stop } = row;
      if (!stopsByTripId.has(trip_id)) stopsByTripId.set(trip_id, []);
      stopsByTripId.get(trip_id)!.push(stop);
    }

    const sortedBranches = [...branchReps].sort(
      (a, b) => parseInt(b.stop_count) - parseInt(a.stop_count),
    );

    const branches: RouteBranch[] = sortedBranches.map((b) => ({
      label: b.trip_headsign ?? routeId,
      directionId: b.direction_id,
      stops: stopsByTripId.get(b.trip_id) ?? [],
    }));

    const stops = branches[0]?.stops ?? [];

    const result: RouteResponse = { ...this.toResponse(route), stops, branches };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ROUTES_TTL_S);
    return result;
  }

  async getShape(routeId: string, agencyKey: string): Promise<GeoJsonLineString | null> {
    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();
    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    const branchRep = await this.routeRepo.query<Array<{ shape_id: string | null }>>(
      `SELECT shape_id
       FROM route_branches
       WHERE route_id = $1 AND agency_id = $2 AND shape_id IS NOT NULL
       ORDER BY stop_count DESC
       LIMIT 1`,
      [routeId, route.agencyId],
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
