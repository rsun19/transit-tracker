/// <reference types="jest" />
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  CacheService,
  HealthController,
  createLogger,
  redisRetryStrategy,
} from '@transit-tracker/shared/nest';

// The shared Nest building blocks (packages/shared/src/nest) are tested here,
// in a service that uses all of them; the shared package has no test runner.

describe('redisRetryStrategy()', () => {
  it('never gives up, so ioredis keeps reconnecting after a Redis restart', () => {
    for (let times = 1; times <= 10_000; times++) {
      const delay = redisRetryStrategy(times);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it('backs off 0.5 s per attempt up to 5 s', () => {
    expect([1, 2, 4, 10, 50].map(redisRetryStrategy)).toEqual([500, 1000, 2000, 5000, 5000]);
  });
});

describe('HealthController', () => {
  const cacheWith = (ping: () => Promise<string>) =>
    ({ getClient: () => ({ ping }) }) as unknown as CacheService;
  const dbWith = (query: () => Promise<unknown>) => ({ query }) as never;

  it('live and the /health alias only report the process', () => {
    const health = new HealthController(
      cacheWith(() => Promise.reject(new Error('down'))),
      undefined,
    );
    expect(health.live()).toMatchObject({ status: 'ok' });
    expect(health.check()).toMatchObject({ status: 'ok' });
  });

  it('ready checks Redis and the database when the service has them', async () => {
    const health = new HealthController(
      cacheWith(() => Promise.resolve('PONG')),
      dbWith(() => Promise.resolve([{ '?column?': 1 }])),
    );
    await expect(health.ready()).resolves.toEqual({
      status: 'ok',
      checks: { redis: 'up', db: 'up' },
    });
  });

  it('ready is 503 and names what is down', async () => {
    const health = new HealthController(
      cacheWith(() => Promise.reject(new Error('ECONNREFUSED'))),
      dbWith(() => Promise.resolve([])),
    );
    const err = await health.ready().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).message).toBe('Not ready: redis down');
  });

  it('ready treats a hung check as down', async () => {
    jest.useFakeTimers();
    try {
      const health = new HealthController(
        undefined,
        dbWith(() => new Promise(() => {})),
      );
      const result = health.ready().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(2000);
      expect(await result).toBeInstanceOf(ServiceUnavailableException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ready with no dependencies is ok', async () => {
    await expect(new HealthController().ready()).resolves.toEqual({ status: 'ok', checks: {} });
  });
});

describe('createLogger()', () => {
  it('writes one JSON object per line', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const logger = createLogger('Stops');
      logger.log('hello');
      logger.error('boom', 'stack', 'Ctx');
      const [first, second] = write.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(first).toMatchObject({ level: 'log', service: 'Stops', message: 'hello' });
      expect(first).not.toHaveProperty('trace');
      expect(second).toMatchObject({
        level: 'error',
        service: 'Ctx',
        message: 'boom',
        trace: 'stack',
      });
    } finally {
      write.mockRestore();
    }
  });
});

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let warnSpy: jest.SpyInstance;

  const connectionError = new Error('Connection refused');

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    // Construct directly with the mock — avoids NestJS DI boilerplate
    service = new CacheService(mockRedis as never);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('get()', () => {
    it('returns the cached value when Redis responds normally', async () => {
      mockRedis.get.mockResolvedValue('{"foo":"bar"}');
      const result = await service.get('some-key');
      expect(result).toBe('{"foo":"bar"}');
    });

    it('returns null when Redis throws (FR-024)', async () => {
      mockRedis.get.mockRejectedValue(connectionError);
      const result = await service.get('some-key');
      expect(result).toBeNull();
    });

    it('emits a WARN log when Redis throws (FR-024)', async () => {
      mockRedis.get.mockRejectedValue(connectionError);
      await service.get('some-key');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cache get failed for key "some-key"'),
      );
    });
  });

  describe('set()', () => {
    it('calls redis.set with EX flag', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await service.set('k', 'v', 30);
      expect(mockRedis.set).toHaveBeenCalledWith('k', 'v', 'EX', 30);
    });

    it('does not throw when Redis rejects', async () => {
      mockRedis.set.mockRejectedValue(connectionError);
      await expect(service.set('k', 'v', 30)).resolves.toBeUndefined();
    });

    it('emits a WARN log when set fails', async () => {
      mockRedis.set.mockRejectedValue(connectionError);
      await service.set('k', 'v', 30);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cache set failed for key "k"'));
    });
  });

  describe('del()', () => {
    it('does not throw when Redis rejects', async () => {
      mockRedis.del.mockRejectedValue(connectionError);
      await expect(service.del('k')).resolves.toBeUndefined();
    });

    it('emits a WARN log when del fails', async () => {
      mockRedis.del.mockRejectedValue(connectionError);
      await service.del('k');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cache del failed for key "k"'));
    });
  });

  describe('getClient()', () => {
    it('returns the underlying Redis instance', () => {
      expect(service.getClient()).toBe(mockRedis);
    });
  });

  describe('onModuleDestroy()', () => {
    it('quits Redis and logs success', async () => {
      const quit = jest.fn().mockResolvedValue(undefined);
      const disconnect = jest.fn();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const redis = { quit, disconnect };
      const service = new CacheService(redis as never);
      await service.onModuleDestroy();
      expect(quit).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Redis connection closed');
      logSpy.mockRestore();
    });

    it('logs a warning and force-disconnects if quit fails', async () => {
      const quit = jest.fn().mockRejectedValue(new Error('fail'));
      const disconnect = jest.fn();
      const redis = { quit, disconnect };
      const service = new CacheService(redis as never);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await service.onModuleDestroy();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to close Redis connection: fail'),
      );
      expect(disconnect).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
