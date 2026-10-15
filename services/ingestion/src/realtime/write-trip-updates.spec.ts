/// <reference types="jest" />
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { addedTripsKey, tripUpdatesKey, type TripRealtime } from '@transit-tracker/shared';
import { writeTripUpdates } from './write-trip-updates';

const AGENCY = 'test-agency';
const TTL = 60;
const LIVE = tripUpdatesKey(AGENCY);
const ADDED = addedTripsKey(AGENCY);

const trip = (tripId: string, overrides: Partial<TripRealtime> = {}): TripRealtime => ({
  tripId,
  routeId: 'Red',
  directionId: 0,
  startDate: '20261014',
  canceled: false,
  stops: [
    {
      stopSequence: 1,
      stopId: '70061',
      arrivalTime: 100,
      departureTime: null,
      delay: null,
      skipped: false,
      uncertainty: null,
    },
  ],
  feedTimestamp: 1,
  ...overrides,
});

const tripsMap = (...trips: TripRealtime[]) => new Map(trips.map((t) => [t.tripId, t]));

describe('writeTripUpdates()', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
  });

  afterEach(() => {
    redis.disconnect();
  });

  it('writes every trip as JSON under the v2 key', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A'), trip('B')), new Map(), TTL);

    const hash = await redis.hgetall(LIVE);
    expect(Object.keys(hash).sort()).toEqual(['A', 'B']);
    expect(JSON.parse(hash['A'])).toEqual(trip('A'));
  });

  it('sets a TTL on the live key', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A')), tripsMap(trip('X')), TTL);

    for (const key of [LIVE, ADDED]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(TTL);
    }
  });

  it('replaces the previous snapshot instead of merging into it', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A'), trip('B')), new Map(), TTL);
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('C')), new Map(), TTL);

    expect(Object.keys(await redis.hgetall(LIVE))).toEqual(['C']);
    expect(await redis.exists(`${LIVE}:tmp`)).toBe(0);
  });

  it('never deletes the live key or writes it outside one MULTI', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A')), tripsMap(trip('X')), TTL);

    const queued: unknown[][] = [];
    const realMulti = redis.multi.bind(redis);
    const multiSpy = jest.spyOn(redis, 'multi').mockImplementation(((...args: unknown[]) => {
      const tx = (realMulti as (...a: unknown[]) => ReturnType<Redis['multi']>)(...args);
      for (const cmd of ['del', 'hset', 'expire', 'rename'] as const) {
        const real = (tx[cmd] as (...a: unknown[]) => unknown).bind(tx);
        (tx as unknown as Record<string, unknown>)[cmd] = (...a: unknown[]) => {
          queued.push([cmd, ...a]);
          return real(...a);
        };
      }
      return tx;
    }) as never);
    const directWrites = (['del', 'hset', 'rename', 'expire'] as const).map((cmd) =>
      jest.spyOn(redis, cmd),
    );

    await writeTripUpdates(redis, AGENCY, tripsMap(trip('B')), tripsMap(trip('Y')), TTL);

    expect(multiSpy).toHaveBeenCalledTimes(1);
    for (const spy of directWrites) expect(spy).not.toHaveBeenCalled();
    expect(queued.filter(([cmd, key]) => cmd === 'del' && (key === LIVE || key === ADDED))).toEqual(
      [],
    );
    expect(queued).toContainEqual(['rename', `${LIVE}:tmp`, LIVE]);
    expect(queued).toContainEqual(['rename', `${ADDED}:tmp`, ADDED]);
    expect(Object.keys(await redis.hgetall(LIVE))).toEqual(['B']);
    expect(Object.keys(await redis.hgetall(ADDED))).toEqual(['Y']);
  });

  it('writes nothing for an empty feed, so the old data expires on its own', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A')), new Map(), TTL);

    const written = await writeTripUpdates(redis, AGENCY, new Map(), new Map(), TTL);

    expect(written).toBe(false);
    expect(Object.keys(await redis.hgetall(LIVE))).toEqual(['A']);
    expect(await redis.ttl(LIVE)).toBeGreaterThan(0);
  });

  it('clears added trips when a non-empty feed has none', async () => {
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A')), tripsMap(trip('X')), TTL);
    await writeTripUpdates(redis, AGENCY, tripsMap(trip('A')), new Map(), TTL);

    expect(await redis.exists(ADDED)).toBe(0);
  });

  it('stores canceled trips so the reader can hide them', async () => {
    await writeTripUpdates(
      redis,
      AGENCY,
      tripsMap(trip('A', { canceled: true, stops: [] })),
      new Map(),
      TTL,
    );

    expect(JSON.parse((await redis.hget(LIVE, 'A'))!)).toMatchObject({ canceled: true, stops: [] });
  });
});
