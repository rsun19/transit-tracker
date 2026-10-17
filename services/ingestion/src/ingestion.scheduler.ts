import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { REALTIME_POLL_INTERVAL_MS } from '@transit-tracker/shared';
import { AgenciesService } from '@transit-tracker/shared/nest';
import { GtfsStaticService } from './gtfs-static.service';
import { GtfsRealtimeService } from './gtfs-realtime.service';
import { StaticLookupService } from './static-lookup.service';
import { WorkerLivenessService } from './worker-liveness.service';

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
    private readonly staticLookup: StaticLookupService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly liveness: WorkerLivenessService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registerSchedules();

    const ingestOnStartup = this.configService.get<string>('GTFS_INGEST_ON_STARTUP') === 'true';
    if (!ingestOnStartup) {
      this.logger.log(
        'Skipping startup GTFS ingestion (set GTFS_INGEST_ON_STARTUP=true to enable)',
      );
      return;
    }
    this.logger.log('Running initial GTFS static ingestion on startup');
    setTimeout(() => void this.runStaticIngestion(), 5000);
  }

  /**
   * Registers the realtime poll and static cron from validated config.
   * (Decorators would read them at import time, before config is loaded.)
   */
  private registerSchedules(): void {
    const intervalMs =
      Number(this.configService.get('GTFS_REALTIME_POLL_INTERVAL_MS')) || REALTIME_POLL_INTERVAL_MS;
    this.schedulerRegistry.addInterval(
      'realtime-poll',
      setInterval(() => void this.runRealtimePoll(), intervalMs),
    );

    const cron = this.configService.get<string>('GTFS_STATIC_CRON') ?? '0 4 * * *';
    const job = new CronJob(cron, () => void this.runStaticIngestion());
    this.schedulerRegistry.addCronJob('static-ingestion', job);
    job.start();

    this.logger.log(`Realtime poll every ${intervalMs} ms; static ingestion cron "${cron}"`);
  }

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
          continue;
        }
        try {
          await this.staticLookup.refresh(agency.key);
        } catch (err: unknown) {
          // The lookup is dropped and reloaded on the next realtime poll.
          this.logger.error(
            `Static lookup refresh failed for agency "${agency.key}": ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
    } finally {
      this.isStaticIngestionRunning = false;
    }
  }

  async runRealtimePoll(): Promise<void> {
    if (this.isRealtimePollRunning) {
      this.logger.warn('Skipping realtime poll tick because a previous run is still in progress');
      return;
    }
    this.isRealtimePollRunning = true;
    try {
      const agencies = this.agenciesService
        .getAllAgencies()
        .filter((a) => a.hasRealtimePositions || a.hasRealtimeTripUpdates || a.hasRealtimeAlerts);
      for (const agency of agencies) {
        try {
          await this.gtfsRealtimeService.pollAgency(agency);
        } catch (err: unknown) {
          this.logger.error(
            `Realtime poll failed for agency "${agency.key}": ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.isRealtimePollRunning = false;
      this.liveness.markAlive();
    }
  }
}
