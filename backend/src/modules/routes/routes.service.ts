import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Route } from './entities/route.entity.js';
import { Shape } from '../ingestion/entities/shape.entity.js';
import { CacheService } from '../cache/cache.service.js';
import { API_CACHE_ROUTES_TTL_S, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from '../../common/constants.js';

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
  shape?: GeoJsonLineString | null;
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

    const cacheKey = `cache:routes:${params.agencyKey ?? 'all'}:${params.routeType ?? ''}:${params.q ?? ''}:${limit}:${offset}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as { data: RouteResponse[]; total: number };

    const qb = this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a');

    if (params.agencyKey) qb.andWhere('a.agency_key = :agencyKey', { agencyKey: params.agencyKey });
    if (params.routeType !== undefined) qb.andWhere('r.route_type = :routeType', { routeType: params.routeType });
    if (params.q) {
      qb.andWhere('(r.short_name ILIKE :q OR r.long_name ILIKE :q)', { q: `%${params.q}%` });
    }

    const [routes, total] = await qb
      .orderBy('r.shortName', 'ASC')
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
    const cacheKey = `cache:route:v2:${agencyKey}:${routeId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as RouteResponse;

    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();

    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    // Resolve one representative shape_id for the route first.
    // Avoiding a correlated subquery here prevents very slow scans on large shape/trip tables.
    const tripRows = await this.routeRepo.query<Array<{ trip_id: string; shape_id: string | null }>>(
      `SELECT t.trip_id, t.shape_id
       FROM trips t
       JOIN agencies a ON a."agencyId" = t.agency_id
       WHERE t.route_id = $1
         AND a.agency_key = $2
         AND EXISTS (
           SELECT 1
           FROM stop_times st
           WHERE st.trip_id = t.trip_id
             AND st.agency_id = t.agency_id
         )
       ORDER BY t.trip_id ASC
       LIMIT 1`,
      [routeId, agencyKey],
    );

    const tripId = tripRows[0]?.trip_id ?? null;
    const shapeId = tripRows[0]?.shape_id ?? null;

    const stops = tripId
      ? await this.routeRepo.query<RouteStopResponse[]>(
          `SELECT
             s.stop_id AS "stopId",
             s.stop_name AS "stopName",
             ST_Y(s.location::geometry) AS latitude,
             ST_X(s.location::geometry) AS longitude,
             st.stop_sequence AS "stopSequence"
           FROM stop_times st
           JOIN agencies a ON a."agencyId" = st.agency_id
           JOIN stops s ON s.stop_id = st.stop_id AND s.agency_id = st.agency_id
           WHERE st.trip_id = $1
             AND a.agency_key = $2
           ORDER BY st.stop_sequence ASC`,
          [tripId, agencyKey],
        )
      : [];

    const shapePoints = shapeId
      ? await this.shapeRepo
          .createQueryBuilder('s')
          .leftJoin('s.agency', 'a')
          .where('s.shape_id = :shapeId', { shapeId })
          .andWhere('a.agency_key = :agencyKey', { agencyKey })
          .orderBy('s.ptSequence', 'ASC')
          .getMany()
      : [];

    let shape: GeoJsonLineString | null = null;
    if (shapePoints.length >= 2) {
      // TypeORM may hydrate geometry as GeoJSON object or WKT string depending on driver/query path.
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
          ? [parseFloat(match[1]), parseFloat(match[2])] as [number, number]
          : [0, 0] as [number, number];
      });
      shape = { type: 'LineString', coordinates: coords };
    }

    const result: RouteResponse = { ...this.toResponse(route), stops, shape };
    await this.cacheService.set(cacheKey, JSON.stringify(result), API_CACHE_ROUTES_TTL_S);
    return result;
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
