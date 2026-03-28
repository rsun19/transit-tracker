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

export interface RouteResponse {
  id: string;
  agencyKey?: string;
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number;
  color: string | null;
  textColor: string | null;
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
      .orderBy('r.short_name', 'ASC')
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
    const cacheKey = `cache:route:${agencyKey}:${routeId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached) as RouteResponse;

    const route = await this.routeRepo
      .createQueryBuilder('r')
      .leftJoin('r.agency', 'a')
      .where('r.route_id = :routeId AND a.agency_key = :agencyKey', { routeId, agencyKey })
      .getOne();

    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    // Assemble shape GeoJSON from ordered shape points
    const shapePoints = await this.shapeRepo
      .createQueryBuilder('s')
      .leftJoin('s.agency', 'a')
      .where('s.shape_id = (SELECT t.shape_id FROM trips t WHERE t.route_id = :routeId AND t.agency_id = r.agency_id LIMIT 1)')
      .andWhere('a.agency_key = :agencyKey', { agencyKey })
      .orderBy('s.pt_sequence', 'ASC')
      .getMany();

    let shape: GeoJsonLineString | null = null;
    if (shapePoints.length >= 2) {
      // location is stored as WKT — parse coordinates from PostGIS
      const coords = shapePoints.map((p) => {
        const match = String(p.location).match(/POINT\(([^ ]+) ([^ )]+)\)/);
        return match ? [parseFloat(match[1]), parseFloat(match[2])] as [number, number] : [0, 0] as [number, number];
      });
      shape = { type: 'LineString', coordinates: coords };
    }

    const result: RouteResponse = { ...this.toResponse(route), shape };
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
