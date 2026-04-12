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
import { AddedTripStop } from '@/modules/stops/stops.types';

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
    if (!agencyConfig.gtfsRealtimeVehiclePositionsUrl && !agencyConfig.gtfsRealtimeTripUpdatesUrl)
      return;

    const headers: Record<string, string> = {};
    if (agencyConfig.resolvedApiKey) {
      headers['x-api-key'] = agencyConfig.resolvedApiKey;
    }

    // Build valid trip_id set for filtering (FR-026)
    const validTripIds = await this.getValidTripIds(agencyConfig.key);

    const vehicles: VehiclePosition[] = [];
    const alerts: ServiceAlert[] = [];
    // tripId -> { [stopId]: { arrivalTime?: number, delay?: number } }
    const tripRealtime: Map<
      string,
      Record<string, { arrivalTime?: number; delay?: number }>
    > = new Map();
    // unscheduled/ADDED trips keyed by tripId
    const addedTrips = new Map<string, AddedTripData>();
    const now = new Date().toISOString();

    // Fetch vehicle positions + alerts from the main realtime feed
    if (agencyConfig.gtfsRealtimeVehiclePositionsUrl) {
      const response = await fetch(agencyConfig.gtfsRealtimeVehiclePositionsUrl, { headers });
      if (!response.ok) {
        throw new Error(`GTFS-RT fetch failed for ${agencyConfig.key}: HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      this.processVehiclesAndAlerts(feed, agencyConfig.key, validTripIds, vehicles, alerts, now);
    }

    // Fetch trip updates from the dedicated TripUpdates feed if configured
    const tripUpdatesUrl =
      agencyConfig.gtfsRealtimeTripUpdatesUrl ?? agencyConfig.gtfsRealtimeVehiclePositionsUrl;
    if (tripUpdatesUrl) {
      const response = await fetch(tripUpdatesUrl, { headers });
      if (!response.ok) {
        throw new Error(
          `GTFS-RT TripUpdates fetch failed for ${agencyConfig.key}: HTTP ${response.status}`,
        );
      }
      const buffer = await response.arrayBuffer();
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      this.processTripUpdates(feed, validTripIds, tripRealtime, addedTrips);
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

    if (tripRealtime.size > 0) {
      const tripUpdateKey = `trip_updates:${agencyConfig.key}`;
      const hash: Record<string, string> = {};
      tripRealtime.forEach((stopMap, tid) => {
        hash[tid] = JSON.stringify(stopMap);
      });
      pipeline.del(tripUpdateKey);
      pipeline.hset(tripUpdateKey, hash);
      pipeline.expire(tripUpdateKey, TRIP_UPDATE_CACHE_TTL_S);
    } else {
      pipeline.del(`trip_updates:${agencyConfig.key}`);
    }

    if (addedTrips.size > 0) {
      const addedKey = `added_trips:${agencyConfig.key}`;
      const addedHash: Record<string, string> = {};
      addedTrips.forEach((trip, tid) => {
        addedHash[tid] = JSON.stringify(trip);
      });
      // DEL before HSET so stale entries from a previous worker cycle (or a
      // restart mid-flight) don't accumulate. The hash must be a point-in-time
      // snapshot of the current feed, not a rolling merge.
      pipeline.del(addedKey);
      pipeline.hset(addedKey, addedHash);
      pipeline.expire(addedKey, TRIP_UPDATE_CACHE_TTL_S);
    } else {
      // No added trips in this feed — clear any leftovers from a previous cycle.
      pipeline.del(`added_trips:${agencyConfig.key}`);
    }

    await pipeline.exec();

    this.logger.log(
      `Realtime poll complete for ${agencyConfig.key}: ${vehicles.length} vehicles, ${alerts.length} alerts, ${tripRealtime.size} trip updates, ${addedTrips.size} added trips`,
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
    tripRealtime: Map<string, Record<string, { arrivalTime?: number; delay?: number }>>,
    addedTrips: Map<string, AddedTripData>,
  ): void {
    for (const entity of feed.entity) {
      if (!entity.tripUpdate) continue;
      const tu = entity.tripUpdate;
      const tripId = tu.trip?.tripId;
      if (!tripId) continue;

      if (validTripIds.has(tripId)) {
        // Scheduled trip — store per-stop arrivalTime and/or delay, using arrival->departure fallback
        const stopMap: Record<
          string,
          { arrivalTime?: number; delay?: number; realtimeArrival?: string }
        > = {};
        for (const stu of tu.stopTimeUpdate ?? []) {
          const sid = stu.stopId;
          if (!sid) continue;
          // Fallback: use arrival first, then departure if missing
          const rawTime = stu.arrival?.time ?? stu.departure?.time;
          const arrivalTime = rawTime != null ? Number(rawTime) : undefined;
          const delay =
            stu.arrival?.delay != null
              ? Number(stu.arrival.delay)
              : stu.departure?.delay != null
                ? Number(stu.departure.delay)
                : undefined;
          if (arrivalTime !== undefined || delay !== undefined) {
            stopMap[sid] = {};
            if (arrivalTime !== undefined) {
              stopMap[sid].arrivalTime = arrivalTime;
              stopMap[sid].realtimeArrival = new Date(arrivalTime * 1000).toISOString();
            }
            if (delay !== undefined) stopMap[sid].delay = delay;
          }
        }
        if (Object.keys(stopMap).length > 0) {
          tripRealtime.set(tripId, stopMap);
        }
      } else {
        // Unscheduled / ADDED trip — collect absolute stop arrival timestamps
        const routeId = tu.trip?.routeId;
        if (!routeId) continue;
        const stops: AddedTripStop[] = [];
        for (const stu of tu.stopTimeUpdate ?? []) {
          const sid = stu.stopId;
          const rawTime = stu.arrival?.time ?? stu.departure?.time;
          const arrivalTime = rawTime != null ? Number(rawTime) : 0;
          if (sid && arrivalTime > 0) {
            stops.push({ stopId: sid, arrivalTime });
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
