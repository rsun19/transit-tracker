import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import fetch from 'node-fetch';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { CacheService } from '@/modules/cache/cache.service';
import { AgenciesService, ResolvedAgency } from '@/modules/agencies/agencies.service';
import {
  VEHICLE_CACHE_TTL_S,
  ALERTS_CACHE_TTL_S,
  TRIP_UPDATE_CACHE_TTL_S,
} from '@/common/constants';

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

interface AddedTripStop {
  stopId: string;
  departureTime: number; // Unix timestamp (seconds)
}

interface AddedTripData {
  tripId: string;
  routeId: string;
  directionId: number | null;
  headsign: string | null;
  stops: AddedTripStop[];
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
    if (!agencyConfig.gtfsRealtimeUrl && !agencyConfig.gtfsRealtimeTripUpdatesUrl) return;

    const headers: Record<string, string> = {};
    if (agencyConfig.resolvedApiKey) {
      headers['x-api-key'] = agencyConfig.resolvedApiKey;
    }

    // Build valid trip_id set for filtering (FR-026)
    const validTripIds = await this.getValidTripIds(agencyConfig.key);

    const vehicles: VehiclePosition[] = [];
    const alerts: ServiceAlert[] = [];
    // tripId -> delay in seconds (from TripUpdate stop time updates)
    const tripDelays = new Map<string, number>();
    // unscheduled/ADDED trips keyed by tripId
    const addedTrips = new Map<string, AddedTripData>();
    const now = new Date().toISOString();

    // Fetch vehicle positions + alerts from the main realtime feed
    if (agencyConfig.gtfsRealtimeUrl) {
      const response = await fetch(agencyConfig.gtfsRealtimeUrl, { headers });
      if (!response.ok) {
        throw new Error(`GTFS-RT fetch failed for ${agencyConfig.key}: HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      this.processVehiclesAndAlerts(feed, agencyConfig.key, validTripIds, vehicles, alerts, now);
    }

    // Fetch trip updates from the dedicated TripUpdates feed if configured
    const tripUpdatesUrl = agencyConfig.gtfsRealtimeTripUpdatesUrl ?? agencyConfig.gtfsRealtimeUrl;
    if (tripUpdatesUrl) {
      const response = await fetch(tripUpdatesUrl, { headers });
      if (!response.ok) {
        throw new Error(
          `GTFS-RT TripUpdates fetch failed for ${agencyConfig.key}: HTTP ${response.status}`,
        );
      }
      const buffer = await response.arrayBuffer();
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      this.processTripUpdates(feed, validTripIds, tripDelays, addedTrips);
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

    if (tripDelays.size > 0) {
      const tripUpdateKey = `trip_updates:${agencyConfig.key}`;
      const hash: Record<string, string> = {};
      tripDelays.forEach((delay, tid) => {
        hash[tid] = String(delay);
      });
      pipeline.hset(tripUpdateKey, hash);
      pipeline.expire(tripUpdateKey, TRIP_UPDATE_CACHE_TTL_S);
    }

    if (addedTrips.size > 0) {
      const addedKey = `added_trips:${agencyConfig.key}`;
      const addedHash: Record<string, string> = {};
      addedTrips.forEach((trip, tid) => {
        addedHash[tid] = JSON.stringify(trip);
      });
      pipeline.hset(addedKey, addedHash);
      pipeline.expire(addedKey, TRIP_UPDATE_CACHE_TTL_S);
    }

    await pipeline.exec();

    this.logger.log(
      `Realtime poll complete for ${agencyConfig.key}: ${vehicles.length} vehicles, ${alerts.length} alerts, ${tripDelays.size} trip updates, ${addedTrips.size} added trips`,
    );
  }

  private processVehiclesAndAlerts(
    feed: transit_realtime.FeedMessage,
    agencyKey: string,
    validTripIds: Set<string>,
    vehicles: VehiclePosition[],
    alerts: ServiceAlert[],
    now: string,
  ): void {
    for (const entity of feed.entity) {
      if (entity.vehicle?.position) {
        const vp = entity.vehicle;
        const tripId = vp.trip?.tripId ?? null;

        // FR-026: Discard positions with unknown trip_id
        if (tripId && !validTripIds.has(tripId)) {
          this.logger.warn(
            `Discarding vehicle position — unknown trip_id: ${JSON.stringify({ vehicleId: vp.vehicle?.id, tripId, agencyKey })}`,
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
          headerText: alert.headerText?.translation?.[0]?.text ?? '',
          descriptionText: alert.descriptionText?.translation?.[0]?.text ?? '',
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
  }

  private processTripUpdates(
    feed: transit_realtime.FeedMessage,
    validTripIds: Set<string>,
    tripDelays: Map<string, number>,
    addedTrips: Map<string, AddedTripData>,
  ): void {
    for (const entity of feed.entity) {
      if (!entity.tripUpdate) continue;
      const tu = entity.tripUpdate;
      const tripId = tu.trip?.tripId;
      if (!tripId) continue;

      if (validTripIds.has(tripId)) {
        // Scheduled trip — extract delay from first stop time update
        for (const stu of tu.stopTimeUpdate ?? []) {
          const d = stu.departure?.delay ?? stu.arrival?.delay ?? null;
          if (d !== null && d !== undefined) {
            tripDelays.set(tripId, Number(d));
            break;
          }
        }
      } else {
        // Unscheduled / ADDED trip — collect absolute stop departure timestamps
        const routeId = tu.trip?.routeId;
        if (!routeId) continue;
        const stops: AddedTripStop[] = [];
        for (const stu of tu.stopTimeUpdate ?? []) {
          const sid = stu.stopId;
          const rawTime = stu.departure?.time ?? stu.arrival?.time;
          const depTime = rawTime != null ? Number(rawTime) : 0;
          if (sid && depTime > 0) {
            stops.push({ stopId: sid, departureTime: depTime });
          }
        }
        if (stops.length > 0) {
          addedTrips.set(tripId, {
            tripId,
            routeId,
            directionId: tu.trip?.directionId != null ? Number(tu.trip.directionId) : null,
            headsign: null,
            stops,
          });
        }
      }
    }
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
