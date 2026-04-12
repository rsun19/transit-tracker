import { Controller, Get, Query } from '@nestjs/common';
import { CacheService } from '@/modules/cache/cache.service';
import { AgenciesService } from '@/modules/agencies/agencies.service';

interface Alert {
  alertId: string;
  headerText: string;
  descriptionText: string;
  routeIds: string[];
  stopIds: string[];
  effect: string;
}

@Controller('api/v1/alerts')
export class AlertsController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly agenciesService: AgenciesService,
  ) {}

  @Get()
  async getAlerts(
    @Query('agencyKey') agencyKey?: string,
    @Query('routeId') routeId?: string,
    @Query('stopId') stopId?: string,
  ) {
    const agencies = agencyKey
      ? [this.agenciesService.getAgencyByKey(agencyKey)].filter(Boolean)
      : this.agenciesService.getAllAgencies().filter((a) => a.hasRealtimePositions);

    const allAlerts: Alert[] = [];

    for (const agency of agencies) {
      if (!agency) continue;
      try {
        const raw = await this.cacheService.get(`alerts:${agency.key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Alert[];
          allAlerts.push(...parsed);
        }
      } catch {
        // Graceful degradation — return empty on Redis unavailability
      }
    }

    // Apply in-process filters
    let filtered = allAlerts;
    if (routeId) filtered = filtered.filter((a) => a.routeIds.includes(routeId));
    if (stopId) filtered = filtered.filter((a) => a.stopIds.includes(stopId));

    return { alerts: filtered };
  }
}
