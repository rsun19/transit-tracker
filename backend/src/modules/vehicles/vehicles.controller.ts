import { Controller, Get, Query, ServiceUnavailableException, Res } from '@nestjs/common';
import { Response } from 'express';
import { CacheService } from '@/modules/cache/cache.service';
import { AgenciesService } from '@/modules/agencies/agencies.service';

@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly agenciesService: AgenciesService,
  ) {}

  @Get('live')
  async getLive(@Res() res: Response, @Query('agencyKey') agencyKey?: string) {
    const agencies = agencyKey
      ? [this.agenciesService.getAgencyByKey(agencyKey)].filter(Boolean)
      : this.agenciesService.getAllAgencies().filter((a) => a.hasRealtimePositions);

    const results: Record<string, unknown>[] = [];

    for (const agency of agencies) {
      if (!agency) continue;
      const key = `vehicles:${agency.key}`;
      let data: unknown[] = [];

      try {
        const raw = await this.cacheService.getClient().get(key);
        if (raw) data = JSON.parse(raw) as unknown[];
      } catch {
        // Redis unreachable — vehicles have no DB fallback (see contracts/api.md)
        throw new ServiceUnavailableException({
          error: 'Live tracking temporarily unavailable',
          statusCode: 503,
        });
      }

      results.push({ agencyKey: agency.key, vehicles: data });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({ data: results });
  }
}
