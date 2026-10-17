import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

// Exit when the realtime poll loop hasn't completed for this long. Docker
// doesn't restart a container for being unhealthy, only when its process
// exits, so the worker has to end itself to get restarted.
export const WORKER_STALL_EXIT_MS = 3 * 60_000;
const WATCHDOG_CHECK_MS = 30_000;

/**
 * Liveness for the ingestion worker, which has no HTTP server.
 *
 * markAlive() is called each time a realtime poll loop completes, whether or
 * not the upstream feeds answered: a feed outage must not restart the worker
 * (each restart can trigger a full static re-import), but a hung loop must.
 * It touches the liveness file the compose healthcheck reads, and a watchdog
 * exits the process once the loop has been stuck for WORKER_STALL_EXIT_MS.
 * The static import runs on its own and doesn't count either way.
 */
@Injectable()
export class WorkerLivenessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerLivenessService.name);
  private lastAliveAt = Date.now();
  private watchdog?: NodeJS.Timeout;

  /** Replaced in tests. */
  exit: (code: number) => void = (code) => process.exit(code);

  constructor(private readonly configService: ConfigService) {}

  private get path(): string {
    return this.configService.get<string>('WORKER_FILE_LIVENESS_PATH') ?? '/tmp/worker-alive';
  }

  onModuleInit(): void {
    this.markAlive();
    this.watchdog = setInterval(() => this.check(), WATCHDOG_CHECK_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.watchdog);
  }

  markAlive(now = Date.now()): void {
    this.lastAliveAt = now;
    try {
      fs.writeFileSync(this.path, new Date(now).toISOString());
    } catch (err: unknown) {
      this.logger.warn(`Could not write liveness file ${this.path}: ${(err as Error).message}`);
    }
  }

  check(now = Date.now()): void {
    const stalledMs = now - this.lastAliveAt;
    if (stalledMs <= WORKER_STALL_EXIT_MS) return;
    this.logger.error(
      `Realtime poll loop hasn't completed for ${Math.round(stalledMs / 1000)} s; exiting so Docker restarts the worker`,
    );
    this.exit(1);
  }
}
