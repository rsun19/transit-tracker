import { Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * ioredis reconnect delay: 0.5 s, 1 s, ... capped at 5 s, forever. Returning
 * null would make ioredis stop reconnecting for good, so a Redis restart
 * would leave the service without Redis until it was restarted itself.
 */
export function redisRetryStrategy(times: number): number {
  return Math.min(times * 500, 5000);
}

export function createRedisClient(url: string, logger = new Logger('Redis')): Redis {
  const client = new Redis(url, {
    enableReadyCheck: true,
    // Commands fail after a few reconnect attempts instead of hanging while
    // Redis is down; callers fall back (schedule only, no cache).
    maxRetriesPerRequest: 3,
    retryStrategy: redisRetryStrategy,
    reconnectOnError: (err: Error) =>
      ['READONLY', 'ECONNRESET'].some((e) => err.message.includes(e)),
  });
  client.on('error', (err: Error) => logger.warn(`Redis connection error: ${err.message}`));
  client.on('reconnecting', (delayMs: number) =>
    logger.warn(`Redis reconnecting in ${delayMs} ms`),
  );
  client.on('ready', () => logger.log('Redis ready'));
  return client;
}

/** Thin wrapper whose get/set/del never throw, so a Redis outage only costs the cache. */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    } catch (err: unknown) {
      this.logger.warn(`Failed to close Redis connection: ${(err as Error).message}`);
      this.redis.disconnect();
    }
  }

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

  getClient(): Redis {
    return this.redis;
  }
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        createRedisClient(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379'),
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
