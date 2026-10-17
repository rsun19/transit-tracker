import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@transit-tracker/shared/nest';
import { StaticLookupService } from './static-lookup.service';
import {
  type ResolvedAgency,
  agencyAuthHeaders,
  alertsKey,
  VEHICLE_CACHE_TTL_S,
  ALERTS_CACHE_TTL_S,
  TRIP_UPDATE_CACHE_TTL_S,
  REALTIME_FEED_MAX_AGE_S,
  REALTIME_FEED_MAX_FUTURE_S,
  REALTIME_FETCH_TIMEOUT_MS,
} from '@transit-tracker/shared';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { parseTripUpdates } from './realtime/parse-trip-updates';
import { parseAlerts } from './realtime/parse-alerts';
import { readAlertEffectDetails } from './realtime/effect-detail';
import { writeTripUpdates } from './realtime/write-trip-updates';
import { optionalEpoch } from './realtime/proto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _fetch: any;
async function getFetch() {
  if (!_fetch) {
    _fetch = (await import('node-fetch')).default;
  }
  return _fetch;
}

@Injectable()
export class GtfsRealtimeService {
  private readonly logger = new Logger(GtfsRealtimeService.name);
  // Header timestamp of the last feed written to Redis, per "<feed>:<agency>".
  private readonly lastWrittenFeedTimestamp = new Map<string, number>();

  constructor(
    private readonly cacheService: CacheService,
    private readonly staticLookup: StaticLookupService,
  ) {}

  async pollAgency(agency: ResolvedAgency): Promise<void> {
    const promises: Promise<void>[] = [];

    if (agency.gtfsRealtimeVehiclePositionsUrl) {
      promises.push(this.pollVehiclePositions(agency));
    }

    if (agency.gtfsRealtimeTripUpdatesUrl) {
      promises.push(this.pollTripUpdates(agency));
    }

    if (agency.gtfsRealtimeAlertsUrl) {
      promises.push(this.pollAlerts(agency));
    }

    await Promise.allSettled(promises);
  }

  private async fetchFeed(
    agency: ResolvedAgency,
    url: string,
    label: string,
  ): Promise<transit_realtime.FeedMessage | null> {
    const raw = await this.fetchFeedBytes(agency, url, label);
    return raw && transit_realtime.FeedMessage.decode(raw);
  }

  private async fetchFeedBytes(
    agency: ResolvedAgency,
    url: string,
    label: string,
  ): Promise<Uint8Array | null> {
    const headers = agencyAuthHeaders(agency);
    const response = await (
      await getFetch()
    )(url, {
      headers,
      signal: AbortSignal.timeout(REALTIME_FETCH_TIMEOUT_MS),
      // node-fetch forwards custom headers across hosts on redirect, so don't
      // follow redirects when sending the API key; a 3xx fails the poll below.
      redirect: Object.keys(headers).length > 0 ? 'manual' : 'follow',
    });
    if (!response.ok) {
      this.logger.warn(`${label} poll returned ${response.status} for ${agency.key}`);
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Returns false when the feed is too old to write, or older than the one
   * already written, so a stale CDN response can't overwrite fresher data.
   */
  private isFeedFresh(
    feed: transit_realtime.FeedMessage,
    agency: ResolvedAgency,
    label: string,
  ): boolean {
    const feedTs = optionalEpoch(feed.header, 'timestamp');
    if (feedTs === null) return true;

    const ageS = Math.floor(Date.now() / 1000) - feedTs;
    if (ageS > REALTIME_FEED_MAX_AGE_S) {
      this.logger.warn(
        `${label} feed for ${agency.key} is ${ageS}s old (limit ${REALTIME_FEED_MAX_AGE_S}s); not writing it`,
      );
      return false;
    }
    if (-ageS > REALTIME_FEED_MAX_FUTURE_S) {
      // Recording a future timestamp would make every later feed look like it
      // went backwards, blocking all writes until restart.
      this.logger.warn(
        `${label} feed for ${agency.key} is ${-ageS}s in the future (limit ${REALTIME_FEED_MAX_FUTURE_S}s); not writing it`,
      );
      return false;
    }
    const lastTs = this.lastWrittenFeedTimestamp.get(`${label}:${agency.key}`);
    if (lastTs !== undefined && feedTs < lastTs) {
      this.logger.warn(
        `${label} feed for ${agency.key} went backwards (${feedTs} < ${lastTs}); not writing it`,
      );
      return false;
    }
    return true;
  }

  private markFeedWritten(
    feed: transit_realtime.FeedMessage,
    agency: ResolvedAgency,
    label: string,
  ) {
    const feedTs = optionalEpoch(feed.header, 'timestamp');
    if (feedTs !== null) this.lastWrittenFeedTimestamp.set(`${label}:${agency.key}`, feedTs);
  }

  private async pollVehiclePositions(agency: ResolvedAgency): Promise<void> {
    try {
      const feed = await this.fetchFeed(
        agency,
        agency.gtfsRealtimeVehiclePositionsUrl!,
        'Vehicle positions',
      );
      if (!feed) return;

      const vehicles = feed.entity
        .filter((e: transit_realtime.IFeedEntity) => e.vehicle)
        .map((e: transit_realtime.IFeedEntity) => ({
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
    const label = 'Trip updates';
    try {
      const feed = await this.fetchFeed(agency, agency.gtfsRealtimeTripUpdatesUrl!, label);
      if (!feed || !this.isFeedFresh(feed, agency, label)) return;

      const lookup = await this.staticLookup.get(agency.key);
      const parsed = parseTripUpdates(feed, lookup?.trips ?? null);

      const written = await writeTripUpdates(
        this.cacheService.getClient(),
        agency.key,
        parsed.tripUpdates,
        parsed.addedTrips,
        TRIP_UPDATE_CACHE_TTL_S,
        parsed.feedTimestamp ?? Math.floor(Date.now() / 1000),
      );
      if (!written) {
        this.logger.warn(
          `${label} feed for ${agency.key} had no trips; letting cached data expire`,
        );
        return;
      }
      this.markFeedWritten(feed, agency, label);

      const { stats } = parsed;
      this.logger.log(
        `${label} for ${agency.key}: ${stats.tripUpdates} trip updates, ${stats.added} added, ${stats.canceled} canceled, ${stats.skippedStops} skipped stops`,
      );
    } catch (err: unknown) {
      this.logger.error(`${label} poll error for ${agency.key}: ${(err as Error).message}`);
    }
  }

  private async pollAlerts(agency: ResolvedAgency): Promise<void> {
    const label = 'Alerts';
    try {
      const raw = await this.fetchFeedBytes(agency, agency.gtfsRealtimeAlertsUrl!, label);
      if (!raw) return;
      const feed = transit_realtime.FeedMessage.decode(raw);
      if (!this.isFeedFresh(feed, agency, label)) return;

      const lookup = await this.staticLookup.get(agency.key);
      const alerts = parseAlerts(feed, lookup?.stops ?? null, readAlertEffectDetails(raw));

      // Written even when empty, so cleared alerts disappear right away.
      await this.cacheService
        .getClient()
        .set(alertsKey(agency.key), JSON.stringify(alerts), 'EX', ALERTS_CACHE_TTL_S);
      this.markFeedWritten(feed, agency, label);
    } catch (err: unknown) {
      this.logger.error(`${label} poll error for ${agency.key}: ${(err as Error).message}`);
    }
  }
}
