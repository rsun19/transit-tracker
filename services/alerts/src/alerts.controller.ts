import { Controller, Get, Query } from '@nestjs/common';
import { alertsKey, isAlertActive, type ServiceAlert } from '@transit-tracker/shared';
import { CacheService } from './cache/cache.service';
import { AgenciesService } from './agencies/agencies.service';

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
      : this.agenciesService.getAllAgencies().filter((a) => a.hasRealtimeAlerts);

    const allAlerts: ServiceAlert[] = [];

    for (const agency of agencies) {
      if (!agency) continue;
      try {
        const raw = await this.cacheService.get(alertsKey(agency.key));
        if (raw) {
          const parsed = JSON.parse(raw) as ServiceAlert[];
          allAlerts.push(...parsed);
        }
      } catch {
        // Graceful degradation
      }
    }

    const nowEpochS = Math.floor(Date.now() / 1000);
    let filtered = allAlerts.filter((a) => isAlertActive(a, nowEpochS));
    if (routeId) filtered = filtered.filter((a) => a.routeIds.includes(routeId));
    // The worker widens stopIds to each informed stop's parent station and
    // child platforms, so an exact match here covers both levels.
    if (stopId) filtered = filtered.filter((a) => a.stopIds.includes(stopId));

    return { alerts: filtered };
  }
}
