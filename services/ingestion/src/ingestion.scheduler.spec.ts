/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AgenciesService } from '@transit-tracker/shared/nest';
import { IngestionScheduler } from './ingestion.scheduler';
import type { GtfsStaticService } from './gtfs-static.service';
import type { GtfsRealtimeService } from './gtfs-realtime.service';
import type { StaticLookupService } from './static-lookup.service';
import type { WorkerLivenessService } from './worker-liveness.service';

function setup(env: Record<string, unknown>, pollAgency: jest.Mock = jest.fn()) {
  const registry = new SchedulerRegistry();
  const markAlive = jest.fn();
  const scheduler = new IngestionScheduler(
    { get: (key: string) => env[key] } as unknown as ConfigService,
    {
      getAllAgencies: () => [{ key: 'mbta', hasRealtimeTripUpdates: true }],
    } as unknown as AgenciesService,
    {} as GtfsStaticService,
    { pollAgency } as unknown as GtfsRealtimeService,
    {} as StaticLookupService,
    registry,
    { markAlive } as unknown as WorkerLivenessService,
  );
  return { scheduler, registry, markAlive };
}

describe('IngestionScheduler', () => {
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    setIntervalSpy = jest.spyOn(global, 'setInterval');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cleanup = (registry: SchedulerRegistry) => {
    for (const name of registry.getIntervals()) registry.deleteInterval(name);
    for (const [name] of registry.getCronJobs()) registry.deleteCronJob(name);
  };

  it('schedules the realtime poll and static cron from config', async () => {
    const { scheduler, registry } = setup({
      GTFS_REALTIME_POLL_INTERVAL_MS: 20_000,
      GTFS_STATIC_CRON: '30 3 * * *',
    });
    await scheduler.onModuleInit();
    try {
      expect(registry.getIntervals()).toEqual(['realtime-poll']);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 20_000);
      expect(registry.getCronJob('static-ingestion').cronTime.source).toBe('30 3 * * *');
    } finally {
      cleanup(registry);
    }
  });

  it('falls back to the defaults', async () => {
    const { scheduler, registry } = setup({});
    await scheduler.onModuleInit();
    try {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
      expect(registry.getCronJob('static-ingestion').cronTime.source).toBe('0 4 * * *');
    } finally {
      cleanup(registry);
    }
  });

  it('marks the worker alive after a poll, even when the feed fails', async () => {
    const pollAgency = jest.fn().mockRejectedValue(new Error('MBTA is down'));
    const { scheduler, markAlive } = setup({}, pollAgency);
    await scheduler.runRealtimePoll();
    expect(pollAgency).toHaveBeenCalledTimes(1);
    expect(markAlive).toHaveBeenCalledTimes(1);
  });

  it('does not mark alive for a tick skipped because the last poll is stuck', async () => {
    let finish!: () => void;
    const pollAgency = jest.fn(() => new Promise<void>((r) => (finish = r)));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { scheduler, markAlive } = setup({}, pollAgency);

    const first = scheduler.runRealtimePoll();
    await scheduler.runRealtimePoll(); // skipped
    expect(markAlive).not.toHaveBeenCalled();

    finish();
    await first;
    expect(markAlive).toHaveBeenCalledTimes(1);
  });
});
