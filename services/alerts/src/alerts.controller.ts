import { Controller, Get, Query } from '@nestjs/common';
import {
  alertsKey,
  isAlertActive,
  isRouteWideAlert,
  isUrgentAlert,
  type ServiceAlert,
} from '@transit-tracker/shared';
import { CacheService } from './cache/cache.service';
import { AgenciesService } from './agencies/agencies.service';

/**
 * Route ids from the `routeIds` query value: comma-separated, possibly
 * repeated (`?routeIds=a&routeIds=b,c` parses to an array). Anything that
 * isn't a string, such as `routeIds[x]=y` objects, is ignored.
 */
export function parseRouteIdsParam(value: unknown): Set<string> {
  const parts = Array.isArray(value) ? value : [value];
  return new Set(
    parts
      .filter((p): p is string => typeof p === 'string')
      .flatMap((p) => p.split(','))
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 100),
  );
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
    // Comma-separated routes serving `stopId`; adds their line-wide alerts
    // (e.g. "Red Line: delays of about 20 minutes") to the stop's own.
    @Query('routeIds') routeIdsParam?: unknown,
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
    if (stopId) {
      const stopRouteIds = parseRouteIdsParam(routeIdsParam);
      filtered = filtered.filter(
        (a) => a.stopIds.includes(stopId) || isRouteWideAlert(a, stopRouteIds),
      );
    }

    return { alerts: filtered.map((a) => ({ ...a, urgent: isUrgentAlert(a) })) };
  }
}
