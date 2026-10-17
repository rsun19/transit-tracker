import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadAgencyConfigs, type ResolvedAgency } from '../agency-config';

/** Agencies from the AGENCY_CONFIG_PATH JSON file, loaded once at startup. */
@Injectable()
export class AgenciesService implements OnModuleInit {
  private readonly logger = new Logger(AgenciesService.name);
  private agencies: ResolvedAgency[] = [];

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const configPath =
      this.configService.get<string>('AGENCY_CONFIG_PATH') ?? './config/agencies.json';
    this.agencies = loadAgencyConfigs(configPath);
    this.logger.log(`Loaded ${this.agencies.length} agency/agencies from ${configPath}`);
  }

  getAllAgencies(): ResolvedAgency[] {
    return this.agencies;
  }

  getAgencyByKey(key: string): ResolvedAgency | undefined {
    return this.agencies.find((a) => a.key === key);
  }
}

@Module({
  providers: [AgenciesService],
  exports: [AgenciesService],
})
export class AgenciesModule {}
