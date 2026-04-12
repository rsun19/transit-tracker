import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';

import { OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class CacheService implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    try {
      // Prefer quit() for graceful shutdown, fallback to disconnect()
      if (typeof this.redis.quit === 'function') {
        await this.redis.quit();
      } else if (typeof this.redis.disconnect === 'function') {
        this.redis.disconnect();
      }
      this.logger.log('Redis connection closed');
    } catch (err: unknown) {
      this.logger.warn(`Failed to close Redis connection: ${(err as Error).message}`);
    }
  }
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (err: unknown) {
      this.logger.warn(`Cache get failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch (err: unknown) {
      this.logger.warn(`Cache set failed for key "${key}": ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err: unknown) {
      this.logger.warn(`Cache del failed for key "${key}": ${(err as Error).message}`);
    }
  }

  /**
   * Returns the raw ioredis client for operations not covered by the wrapper
   * (e.g. HSET, HGETALL, pipeline). Callers must handle ioredis errors themselves.
   */
  getClient(): Redis {
    return this.redis;
  }
}
