import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { z } from 'zod';

const AgencyConfigSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, 'Agency key must match [a-z0-9-]+'),
  displayName: z.string().min(1),
  timezone: z.string().min(1),
  gtfsStaticUrl: z.string().url(),
  gtfsRealtimeUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().optional(),
});

export type AgencyConfig = z.infer<typeof AgencyConfigSchema>;

export interface ResolvedAgency extends AgencyConfig {
  resolvedApiKey: string | undefined;
  hasRealtime: boolean;
}

@Injectable()
export class AgenciesService implements OnModuleInit {
  private readonly logger = new Logger(AgenciesService.name);
  private agencies: ResolvedAgency[] = [];

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const configPath =
      this.configService.get<string>('AGENCY_CONFIG_PATH') ?? './config/agencies.json';
    this.agencies = this.loadAndResolve(configPath);
    this.logger.log(`Loaded ${this.agencies.length} agency/agencies from ${configPath}`);
  }

  private loadAndResolve(configPath: string): ResolvedAgency[] {
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
          this.logger.warn(
            `Agency "${config.key}" declares apiKeyEnvVar "${config.apiKeyEnvVar}" but the variable is not set at runtime`,
          );
        }
      }

      resolved.push({
        ...config,
        resolvedApiKey,
        hasRealtime: Boolean(config.gtfsRealtimeUrl),
      });
    }

    return resolved;
  }

  getAllAgencies(): ResolvedAgency[] {
    return this.agencies;
  }

  getAgencyByKey(key: string): ResolvedAgency | undefined {
    return this.agencies.find((a) => a.key === key);
  }
}
