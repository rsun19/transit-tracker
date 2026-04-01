import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AgenciesService } from '@/modules/agencies/agencies.service';
import { GtfsStaticService } from './gtfs-static.service';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import { REALTIME_POLL_INTERVAL_MS } from '@/common/constants';

@Injectable()
export class IngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(IngestionScheduler.name);
  private isStaticIngestionRunning = false;
  private isRealtimePollRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly agenciesService: AgenciesService,
    private readonly gtfsStaticService: GtfsStaticService,
    private readonly gtfsRealtimeService: GtfsRealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ingestOnStartup = this.configService.get<string>('GTFS_INGEST_ON_STARTUP') === 'true';
    if (!ingestOnStartup) {
      this.logger.log(
        'Skipping startup GTFS ingestion (set GTFS_INGEST_ON_STARTUP=true to enable)',
      );
      return;
    }
    this.logger.log('Running initial GTFS static ingestion on startup');
    // Run in background so the worker process fully starts first
    setTimeout(() => void this.runStaticIngestion(), 5000);
  }

  @Cron(process.env['GTFS_STATIC_CRON'] ?? '0 4 * * *')
  async runStaticIngestion(): Promise<void> {
    if (this.isStaticIngestionRunning) {
      this.logger.warn(
        'Skipping static ingestion tick because a previous run is still in progress',
      );
      return;
    }

    this.isStaticIngestionRunning = true;
    this.logger.log('Starting scheduled GTFS static ingestion for all agencies');
    try {
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
    } finally {
      this.isStaticIngestionRunning = false;
    }
  }

  @Interval(REALTIME_POLL_INTERVAL_MS)
  async runRealtimePoll(): Promise<void> {
    if (this.isRealtimePollRunning) {
      this.logger.warn('Skipping realtime poll tick because a previous run is still in progress');
      return;
    }

    this.isRealtimePollRunning = true;
    try {
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
    } finally {
      this.isRealtimePollRunning = false;
    }
  }
}
