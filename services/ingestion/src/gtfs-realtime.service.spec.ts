/// <reference types="jest" />
import { transit_realtime } from 'gtfs-realtime-bindings';
import type { ResolvedAgency } from '@transit-tracker/shared';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import type { CacheService } from '@transit-tracker/shared/nest';
import type { StaticLookupService } from './static-lookup.service';

const NOW = 1_792_000_000;
const agency = { key: 'mbta' } as ResolvedAgency;
const feedAt = (timestamp: number) =>
  transit_realtime.FeedMessage.decode(
    transit_realtime.FeedMessage.encode(
      transit_realtime.FeedMessage.fromObject({
        header: { gtfsRealtimeVersion: '2.0', timestamp },
      }),
    ).finish(),
  );

describe('GtfsRealtimeService feed freshness', () => {
  let service: GtfsRealtimeService;
  // Private methods, exercised directly to avoid network and Redis.
  let isFresh: (feed: transit_realtime.FeedMessage) => boolean;
  let markWritten: (feed: transit_realtime.FeedMessage) => void;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    service = new GtfsRealtimeService({} as CacheService, {} as StaticLookupService);
    const internals = service as unknown as {
      isFeedFresh(f: transit_realtime.FeedMessage, a: ResolvedAgency, l: string): boolean;
      markFeedWritten(f: transit_realtime.FeedMessage, a: ResolvedAgency, l: string): void;
    };
    isFresh = (feed) => internals.isFeedFresh(feed, agency, 'Trip updates');
    markWritten = (feed) => internals.markFeedWritten(feed, agency, 'Trip updates');
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a current feed', () => {
    expect(isFresh(feedAt(NOW - 5))).toBe(true);
  });

  it('rejects a feed older than the max age', () => {
    expect(isFresh(feedAt(NOW - 600))).toBe(false);
  });

  it('rejects a feed stamped in the future, so it cannot block later feeds', () => {
    expect(isFresh(feedAt(NOW + 3600))).toBe(false);
  });

  it('tolerates small clock skew', () => {
    expect(isFresh(feedAt(NOW + 30))).toBe(true);
  });

  it('rejects a feed older than the last one written', () => {
    markWritten(feedAt(NOW - 5));
    expect(isFresh(feedAt(NOW - 10))).toBe(false);
  });
});
