import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from './cache';

const CHECK_TIMEOUT_MS = 2000;

type CheckResult = 'up' | 'down';

async function probe(check: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * - /health/live: the process is up.
 * - /health/ready: it can serve — Redis answers PING and, for services with a
 *   database, Postgres answers SELECT 1. 503 otherwise. Used by the compose
 *   healthchecks.
 * - /health: alias of live, kept for nginx and existing checks.
 *
 * Add it to a module's controllers; it checks whichever of CacheService and
 * the TypeORM DataSource that module can see.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly cache?: CacheService,
    @Optional() @Inject(DataSource) private readonly dataSource?: DataSource,
  ) {}

  @Get()
  check() {
    return this.live();
  }

  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, CheckResult> = {};
    const cache = this.cache;
    const dataSource = this.dataSource;
    if (cache) checks['redis'] = await probe(() => cache.getClient().ping());
    if (dataSource) checks['db'] = await probe(() => dataSource.query('SELECT 1'));
    const down = Object.keys(checks).filter((name) => checks[name] !== 'up');
    if (down.length > 0)
      throw new ServiceUnavailableException(`Not ready: ${down.join(', ')} down`);
    return { status: 'ok', checks };
  }
}
