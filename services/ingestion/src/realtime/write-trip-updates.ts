import type Redis from 'ioredis';
import type { ChainableCommander } from 'ioredis';
import {
  TRIP_UPDATE_FEED_TS_TTL_S,
  addedTripsKey,
  tripUpdatesFeedTsKey,
  tripUpdatesKey,
  type TripRealtime,
} from '@transit-tracker/shared';

/**
 * Replaces the trip_updates and added_trips hashes for an agency in one MULTI.
 *
 * Each hash is built under a `:tmp` key, given a TTL, then RENAMEd over the
 * live key, so readers never see a missing or half-written hash, and data
 * from a dead feed expires on its own.
 *
 * An empty feed (no trips at all) writes nothing, so the live keys expire
 * instead of serving old predictions forever. A non-empty feed is
 * authoritative for both keys: a hash with no entries is deleted.
 *
 * The feed timestamp is recorded in the same MULTI under a longer-lived key
 * (tripUpdatesFeedTsKey), so clients can report staleness once the hashes
 * have expired.
 *
 * @returns false when nothing was written because the feed was empty.
 */
export async function writeTripUpdates(
  redis: Redis,
  agencyKey: string,
  tripUpdates: ReadonlyMap<string, TripRealtime>,
  addedTrips: ReadonlyMap<string, TripRealtime>,
  ttlSeconds: number,
  feedTimestamp: number,
): Promise<boolean> {
  if (tripUpdates.size === 0 && addedTrips.size === 0) return false;

  const tx = redis.multi();
  swapHash(tx, tripUpdatesKey(agencyKey), tripUpdates, ttlSeconds);
  swapHash(tx, addedTripsKey(agencyKey), addedTrips, ttlSeconds);
  tx.set(tripUpdatesFeedTsKey(agencyKey), String(feedTimestamp), 'EX', TRIP_UPDATE_FEED_TS_TTL_S);

  const results = await tx.exec();
  if (!results) throw new Error('Redis MULTI was aborted');
  const failed = results.find(([err]) => err);
  if (failed) throw failed[0];
  return true;
}

function swapHash(
  tx: ChainableCommander,
  liveKey: string,
  entries: ReadonlyMap<string, TripRealtime>,
  ttlSeconds: number,
): void {
  if (entries.size === 0) {
    tx.del(liveKey);
    return;
  }
  const tmpKey = `${liveKey}:tmp`;
  const hash: Record<string, string> = {};
  for (const [field, trip] of entries) hash[field] = JSON.stringify(trip);

  // Clear any leftover tmp key so the new hash can't inherit stale fields.
  tx.del(tmpKey);
  tx.hset(tmpKey, hash);
  tx.expire(tmpKey, ttlSeconds);
  tx.rename(tmpKey, liveKey);
}
