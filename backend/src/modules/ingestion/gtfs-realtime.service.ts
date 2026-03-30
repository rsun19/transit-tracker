import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import fetch from 'node-fetch';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { CacheService } from '../cache/cache.service.js';
import { AgenciesService, ResolvedAgency } from '../agencies/agencies.service.js';
import { VEHICLE_CACHE_TTL_S, ALERTS_CACHE_TTL_S } from '../../common/constants.js';

interface VehiclePosition {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed: number | null;
  label: string | null;
  updatedAt: string;
}

interface ServiceAlert {
  alertId: string;
  headerText: string;
  descriptionText: string;
  routeIds: string[];
  stopIds: string[];
  effect: string;
}

@Injectable()
export class GtfsRealtimeService {
  private readonly logger = new Logger(GtfsRealtimeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly agenciesService: AgenciesService,
  ) {}

  async pollAgency(agencyConfig: ResolvedAgency): Promise<void> {
    if (!agencyConfig.gtfsRealtimeUrl) return;

    const headers: Record<string, string> = {};
    if (agencyConfig.resolvedApiKey) {
      headers['x-api-key'] = agencyConfig.resolvedApiKey;
    }

    const response = await fetch(agencyConfig.gtfsRealtimeUrl, { headers });
    if (!response.ok) {
      throw new Error(`GTFS-RT fetch failed for ${agencyConfig.key}: HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    // Build valid trip_id set for filtering (FR-026)
    const validTripIds = await this.getValidTripIds(agencyConfig.key);

    const vehicles: VehiclePosition[] = [];
    const alerts: ServiceAlert[] = [];
    const now = new Date().toISOString();

    for (const entity of feed.entity) {
      if (entity.vehicle?.position) {
        const vp = entity.vehicle;
        const tripId = vp.trip?.tripId ?? null;

        // FR-026: Discard positions with unknown trip_id
        if (tripId && !validTripIds.has(tripId)) {
          this.logger.warn(
            `Discarding vehicle position — unknown trip_id: ${JSON.stringify({ vehicleId: vp.vehicle?.id, tripId, agencyKey: agencyConfig.key })}`,
          );
          continue;
        }

        vehicles.push({
          vehicleId: vp.vehicle?.id ?? entity.id ?? 'unknown',
          tripId,
          routeId: vp.trip?.routeId ?? null,
          latitude: vp.position?.latitude ?? 0,
          longitude: vp.position?.longitude ?? 0,
          bearing: vp.position?.bearing ?? null,
          speed: vp.position?.speed ?? null,
          label: vp.vehicle?.label ?? null,
          updatedAt: now,
        });
      }

      if (entity.alert) {
        const alert = entity.alert;
        alerts.push({
          alertId: entity.id ?? 'unknown',
          headerText:
            alert.headerText?.translation?.[0]?.text ?? '',
          descriptionText:
            alert.descriptionText?.translation?.[0]?.text ?? '',
          routeIds: (alert.informedEntity ?? [])
            .map((e) => e.routeId)
            .filter((id): id is string => Boolean(id)),
          stopIds: (alert.informedEntity ?? [])
            .map((e) => e.stopId)
            .filter((id): id is string => Boolean(id)),
          effect: alert.effect?.toString() ?? 'UNKNOWN_EFFECT',
        });
      }
    }

    // Write to Redis via pipeline (FR-007, FR-008)
    const redis = this.cacheService.getClient();
    const pipeline = redis.pipeline();

    const vehicleKey = `vehicles:${agencyConfig.key}`;
    const alertKey = `alerts:${agencyConfig.key}`;

    if (vehicles.length > 0) {
      pipeline.set(vehicleKey, JSON.stringify(vehicles), 'EX', VEHICLE_CACHE_TTL_S);
    }
    pipeline.set(alertKey, JSON.stringify(alerts), 'EX', ALERTS_CACHE_TTL_S);

    await pipeline.exec();

    this.logger.log(
      `Realtime poll complete for ${agencyConfig.key}: ${vehicles.length} vehicles, ${alerts.length} alerts`,
    );
  }

  private async getValidTripIds(agencyKey: string): Promise<Set<string>> {
    const rows = await this.dataSource.query<Array<{ trip_id: string }>>(
      `SELECT t.trip_id FROM trips t
       JOIN agencies a ON a."agencyId" = t.agency_id
       WHERE a.agency_key = $1`,
      [agencyKey],
    );
    return new Set(rows.map((r) => r.trip_id));
  }
}
