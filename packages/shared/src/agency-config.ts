import * as fs from 'fs';
import { z } from 'zod';

const AgencyConfigSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, 'Agency key must match [a-z0-9-]+'),
  displayName: z.string().min(1),
  timezone: z.string().min(1),
  gtfsStaticUrl: z.string().url(),
  gtfsRealtimeVehiclePositionsUrl: z.string().url().optional(),
  gtfsRealtimeTripUpdatesUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().optional(),
});

export type AgencyConfig = z.infer<typeof AgencyConfigSchema>;

export interface ResolvedAgency extends AgencyConfig {
  resolvedApiKey: string | undefined;
  hasRealtimePositions: boolean;
  hasRealtimeTripUpdates: boolean;
}

export function loadAgencyConfigs(configPath: string): ResolvedAgency[] {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown[];
  const resolved: ResolvedAgency[] = [];

  for (const entry of raw) {
    const result = AgencyConfigSchema.safeParse(entry);
    if (!result.success) {
      throw new Error(
        `Invalid agency config: ${result.error.errors.map((e) => e.message).join(', ')}`,
      );
    }
    const config = result.data;
    let resolvedApiKey: string | undefined;

    if (config.apiKeyEnvVar) {
      resolvedApiKey = process.env[config.apiKeyEnvVar];
      if (!resolvedApiKey) {
        console.warn(
          `[AgencyConfig] Agency "${config.key}" declares apiKeyEnvVar "${config.apiKeyEnvVar}" but the variable is not set at runtime`,
        );
      }
    }

    resolved.push({
      ...config,
      resolvedApiKey,
      hasRealtimePositions: Boolean(config.gtfsRealtimeVehiclePositionsUrl),
      hasRealtimeTripUpdates: Boolean(config.gtfsRealtimeTripUpdatesUrl),
    });
  }

  return resolved;
}
