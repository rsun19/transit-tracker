import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache/cache.service';
import {
  type ResolvedAgency,
  VEHICLE_CACHE_TTL_S,
  ALERTS_CACHE_TTL_S,
} from '@transit-tracker/shared';
import fetch from 'node-fetch';
import { transit_realtime } from 'gtfs-realtime-bindings';

@Injectable()
export class GtfsRealtimeService {
  private readonly logger = new Logger(GtfsRealtimeService.name);

  constructor(private readonly cacheService: CacheService) {}

  async pollAgency(agency: ResolvedAgency): Promise<void> {
    const promises: Promise<void>[] = [];

    if (agency.gtfsRealtimeVehiclePositionsUrl) {
      promises.push(this.pollVehiclePositions(agency));
    }

    if (agency.gtfsRealtimeTripUpdatesUrl) {
      promises.push(this.pollTripUpdates(agency));
    }

    await Promise.allSettled(promises);
  }

  private async pollVehiclePositions(agency: ResolvedAgency): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (agency.resolvedApiKey) headers['Authorization'] = `Bearer ${agency.resolvedApiKey}`;

      const response = await fetch(agency.gtfsRealtimeVehiclePositionsUrl!, { headers });
      if (!response.ok) {
        this.logger.warn(`Vehicle positions poll returned ${response.status} for ${agency.key}`);
        return;
      }

      const buffer = await response.arrayBuffer();

      // Parse GTFS-RT protobuf
      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

      const vehicles = feed.entity
        .filter((e: any) => e.vehicle)
        .map((e: any) => ({
          id: e.vehicle?.vehicle?.id,
          tripId: e.vehicle?.trip?.tripId,
          routeId: e.vehicle?.trip?.routeId,
          latitude: e.vehicle?.position?.latitude,
          longitude: e.vehicle?.position?.longitude,
          bearing: e.vehicle?.position?.bearing,
          speed: e.vehicle?.position?.speed,
          timestamp: e.vehicle?.timestamp?.toString(),
          occupancyStatus: e.vehicle?.occupancyStatus?.toString(),
        }));

      await this.cacheService
        .getClient()
        .set(`vehicles:${agency.key}`, JSON.stringify(vehicles), 'EX', VEHICLE_CACHE_TTL_S);
    } catch (err: unknown) {
      this.logger.error(
        `Vehicle positions poll error for ${agency.key}: ${(err as Error).message}`,
      );
    }
  }

  private async pollTripUpdates(agency: ResolvedAgency): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (agency.resolvedApiKey) headers['Authorization'] = `Bearer ${agency.resolvedApiKey}`;

      const response = await fetch(agency.gtfsRealtimeTripUpdatesUrl!, { headers });
      if (!response.ok) {
        this.logger.warn(`Trip updates poll returned ${response.status} for ${agency.key}`);
        return;
      }

      const buffer = await response.arrayBuffer();

      const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

      // trip_updates: hash keyed by trip_id -> { stop_id: { delay, arrivalTime } }
      const tripUpdates: Record<
        string,
        Record<string, { delay: number; arrivalTime?: number }>
      > = {};
      // alerts: array
      const alerts: unknown[] = [];
      // added_trips: hash keyed by trip_id -> { stops: [...] }
      const addedTrips: Record<
        string,
        {
          tripId: string;
          routeId: string;
          directionId: number | null;
          headsign: string | null;
          stops: { stopId: string; arrivalTime: number }[];
        }
      > = {};

      for (const entity of feed.entity) {
        if (entity.tripUpdate?.trip) {
          const tripId = entity.tripUpdate.trip.tripId;
          if (!tripId) continue;

          const stopTimeUpdates: Record<string, { delay: number; arrivalTime?: number }> = {};
          for (const stu of entity.tripUpdate.stopTimeUpdate ?? []) {
            const stopId = stu.stopId;
            if (!stopId) continue;
            const delay = stu.arrival?.delay ?? stu.departure?.delay ?? 0;
            const arrivalTime = stu.arrival?.time?.toString();
            stopTimeUpdates[stopId] = {
              delay,
              ...(arrivalTime ? { arrivalTime: parseInt(arrivalTime, 10) } : {}),
            };
          }

          if (Object.keys(stopTimeUpdates).length > 0) {
            tripUpdates[tripId] = stopTimeUpdates;
          }
        }

        if (entity.alert) {
          alerts.push({
            alertId: entity.id,
            headerText: entity.alert?.headerText?.translation?.[0]?.text ?? '',
            descriptionText: entity.alert?.descriptionText?.translation?.[0]?.text ?? '',
            routeIds:
              (entity.alert?.informedEntity ?? [])
                .filter((e: any) => e.routeId)
                .map((e: any) => e.routeId!) ?? [],
            stopIds:
              (entity.alert?.informedEntity ?? [])
                .filter((e: any) => e.stopId)
                .map((e: any) => e.stopId!) ?? [],
            effect: entity.alert?.effect?.toString() ?? '',
          });
        }
      }

      const redis = this.cacheService.getClient();

      if (Object.keys(tripUpdates).length > 0) {
        await redis.del(`trip_updates:${agency.key}`);
        for (const [tripId, stops] of Object.entries(tripUpdates)) {
          await redis.hset(`trip_updates:${agency.key}`, tripId, JSON.stringify(stops));
        }
      }

      if (alerts.length > 0) {
        await redis.set(`alerts:${agency.key}`, JSON.stringify(alerts), 'EX', ALERTS_CACHE_TTL_S);
      }

      if (Object.keys(addedTrips).length > 0) {
        await redis.del(`added_trips:${agency.key}`);
        for (const [tripId, trip] of Object.entries(addedTrips)) {
          await redis.hset(`added_trips:${agency.key}`, tripId, JSON.stringify(trip));
        }
      }
    } catch (err: unknown) {
      this.logger.error(`Trip updates poll error for ${agency.key}: ${(err as Error).message}`);
    }
  }
}
