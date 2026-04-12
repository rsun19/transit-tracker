import { Logger } from '@nestjs/common';
import { CacheService } from '@/modules/cache/cache.service';

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
    it('calls redis.quit if available and logs success', async () => {
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

    it('calls redis.disconnect if quit is not available', async () => {
      const disconnect = jest.fn();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const redis = { disconnect };
      const service = new CacheService(redis as never);
      await service.onModuleDestroy();
      expect(disconnect).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Redis connection closed');
      logSpy.mockRestore();
    });

    it('logs a warning if shutdown throws', async () => {
      const quit = jest.fn().mockRejectedValue(new Error('fail'));
      const disconnect = jest.fn();
      const redis = { quit, disconnect };
      const service = new CacheService(redis as never);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await service.onModuleDestroy();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to close Redis connection: fail'),
      );
      warnSpy.mockRestore();
    });
  });
});
