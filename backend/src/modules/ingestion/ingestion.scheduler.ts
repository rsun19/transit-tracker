import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AgenciesService } from '../agencies/agencies.service.js';
import { GtfsStaticService } from './gtfs-static.service.js';
import { GtfsRealtimeService } from './gtfs-realtime.service.js';
import { REALTIME_POLL_INTERVAL_MS } from '../../common/constants.js';

@Injectable()
export class IngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(IngestionScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly agenciesService: AgenciesService,
    private readonly gtfsStaticService: GtfsStaticService,
    private readonly gtfsRealtimeService: GtfsRealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Running initial GTFS static ingestion on startup');
    // Run in background so the worker process fully starts first
    setTimeout(() => void this.runStaticIngestion(), 5000);
  }

  @Cron(process.env['GTFS_STATIC_CRON'] ?? '0 4 * * *')
  async runStaticIngestion(): Promise<void> {
    this.logger.log('Starting scheduled GTFS static ingestion for all agencies');
    const agencies = this.agenciesService.getAllAgencies();

    for (const agency of agencies) {
      try {
        await this.gtfsStaticService.ingestAgency(agency);
      } catch (err: unknown) {
        this.logger.error(
          `Static ingestion failed for agency "${agency.key}": ${(err as Error).message}`,
          (err as Error).stack,
        );
        // Continue with remaining agencies (FR-006)
      }
    }
  }

  @Interval(REALTIME_POLL_INTERVAL_MS)
  async runRealtimePoll(): Promise<void> {
    const agencies = this.agenciesService.getAllAgencies().filter((a) => a.hasRealtime);

    for (const agency of agencies) {
      try {
        await this.gtfsRealtimeService.pollAgency(agency);
      } catch (err: unknown) {
        this.logger.error(
          `Realtime poll failed for agency "${agency.key}": ${(err as Error).message}`,
        );
        // Continue with remaining agencies
      }
    }
  }
}
