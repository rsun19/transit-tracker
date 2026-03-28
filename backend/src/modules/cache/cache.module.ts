import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service.js';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const redisUrl = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const client = new Redis(redisUrl, {
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => {
            if (times >= 3) return null; // Stop retrying after 3 attempts
            return Math.min(times * 500, 2000); // Geometric backoff: 500ms, 1000ms, 2000ms
          },
          reconnectOnError: (err: Error) => {
            const targetErrors = ['READONLY', 'ECONNRESET'];
            return targetErrors.some((e) => err.message.includes(e));
          },
        });

        client.on('error', (err: Error) => {
          process.stdout.write(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: 'warn',
              service: 'Redis',
              message: `Redis connection error: ${err.message}`,
            }) + '\n',
          );
        });

        return client;
      },
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
