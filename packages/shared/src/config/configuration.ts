import { z } from 'zod';

export const configSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection URL'),
  AGENCY_CONFIG_PATH: z.string().min(1, 'AGENCY_CONFIG_PATH is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GTFS_STATIC_CRON: z.string().default('0 4 * * *'),
  GTFS_REALTIME_POLL_INTERVAL_MS: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0, 'GTFS_REALTIME_POLL_INTERVAL_MS must be a positive integer')
    .default('15000'),
  WORKER_FILE_LIVENESS_PATH: z.string().default('/tmp/worker-alive'),
  PORT: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default('3000'),
});

export type AppConfig = z.infer<typeof configSchema> & { PORT: number };

export function validateConfig(config: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${messages}`);
  }
  return result.data as AppConfig;
}
