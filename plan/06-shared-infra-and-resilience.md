# Shared infra module plus Redis and worker resilience

**Type:** reliability and refactor
**Touches:** `services/*/src/cache/*`, `services/*/src/agencies/*`, `services/*/src/main.ts`, `services/*/src/health.controller.ts`, `services/ingestion/src/{worker.ts,ingestion.scheduler.ts}`, `packages/shared/`, `docker-compose.yml`
**Depends on:** nothing. Land it before PR 07–09 so they only edit one copy of the cache code.

## Problem

1. **Redis gives up reconnecting permanently.** `cache.module.ts:17-20` (copied into 5 services) returns `null` from `retryStrategy` after 3 attempts (about 1.5 s), and ioredis then never reconnects. After any Redis restart:
   - `vehicles` returns 503 forever (`vehicles.controller.ts:29-33`);
   - `stops` silently loses realtime and caching (the empty `catch {}` blocks at `stops.service.ts:336,437,744`);
   - ingestion can't write.

   Health checks only report uptime, so Docker never restarts anything.
2. **The worker liveness check is fake.** `worker.ts:58-59` touches `/tmp/worker-alive` once at boot, and the compose healthcheck (`docker-compose.yml:177`) only checks that the file exists. A hung poll loop (see the fetch-timeout item in PR 02) or a hung static download (`gtfs-static.service.ts:326`, no timeout) looks healthy forever.
3. **Redis has no memory limit.** `docker-compose.yml:29` sets no `maxmemory` and no eviction policy. User-controlled cache keys (PR 09) can grow it until the OOM killer takes it down, which then triggers problem 1.
4. **The scheduler ignores config.** `ingestion.scheduler.ts:61` uses the constant `REALTIME_POLL_INTERVAL_MS` instead of the validated `GTFS_REALTIME_POLL_INTERVAL_MS`. `:34` reads `GTFS_STATIC_CRON` from `process.env` at import time.
5. **Copy-pasted infrastructure:**
   - `cache.module.ts` and `cache.service.ts` are byte-identical in 5 services;
   - `agencies.service.ts` is identical in 3;
   - the JSON logger boilerplate is repeated in 6 `main.ts` files;
   - `HttpExceptionFilter` exists only in routes and stops.

   Every fix currently has to be made 5 times.

## Changes

1. Create `packages/shared/src/nest/`, containing `CacheModule`/`CacheService`, `AgenciesModule`, `createLogger()`, `HttpExceptionFilter`, and `bootstrapService(module, port)` (logger, filter, `x-powered-by` off, graceful shutdown hooks). Switch all six services to it and delete the copies.
2. ioredis: `retryStrategy: (n) => Math.min(n * 500, 5000)` (never `null`), keep `maxRetriesPerRequest: 3` so requests fail fast, and log on `reconnecting` / `ready`.
3. Health: `@nestjs/terminus` with `/health/live` (process only) and `/health/ready` (Redis `PING`; DB `SELECT 1` for DB-using services). Point the compose healthchecks at `/health/ready`. Keep the `/health` alias for nginx.
4. Worker liveness: touch the file after every successful realtime poll. Healthcheck: `test: ["CMD-SHELL", "find /tmp/worker-alive -mmin -2 | grep -q ."]`.
5. Static download: `AbortSignal.timeout(5 * 60_000)` plus a max `content-length` / streamed byte cap (e.g. 200 MB); this also covers the zip-size item in PR 07.
6. Use `SchedulerRegistry` to register the realtime interval and static cron from `ConfigService` at `onModuleInit`.
7. Redis: `command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save ""`. The realtime keys are rebuilt every 15 s, so persistence isn't needed. Make sure the realtime keys keep their TTLs (PR 02) so LRU can evict cache keys first; consider `volatile-lru`.

## Tests

- Unit test: the retry strategy never returns null.
- e2e/manual: `docker compose restart cache`; within about 5 s, vehicles and stops are back to serving realtime, with no service restart.
