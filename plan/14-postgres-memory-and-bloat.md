# Size Postgres for the box; reclaim bloat; measure queries

**Type:** performance (configuration)
**Touches:** `docker-compose.yml` (`db` command, `mem_limit`), a new migration (index hygiene), `docs/deployment.md`
**Depends on:** nothing. Do it first: it's the cheapest win, and `pg_stat_statements` gives the later plans a baseline.

## Problem

All numbers below were measured on production on 2026-10-17, using `pg_stat_user_tables` and `pg_stat_user_indexes` since the database was created, plus `free -m`.

1. **Postgres gets 32 MB of shared memory on a 3.8 GB box.**
   - `docker-compose.yml:6-10` sets `shared_buffers=32MB`, `work_mem=4MB`, `max_wal_size=64MB` and `checkpoint_timeout=30s`.
   - `stop_times` alone is **2.7 GB**: a 797 MB heap plus 1.9 GB of indexes. Every arrivals query reads index pages through the OS page cache or from disk.
   - The server has 3 vCPUs, and about 2.8 GB of RAM is available. All the app containers together use under 300 MB.
2. **Checkpoints are forced constantly during loads.**
   - Each static load writes about 3.1M `stop_times` rows plus their index entries in one transaction (plan 07). With `max_wal_size=64MB` and a 30 s `checkpoint_timeout`, Postgres checkpoints over and over while that runs.
   - The first atomic load in production spent **257 s in the swap**. The same swap took 25 s on a laptop with default settings.
3. **`stop_times` is bloated about 2.2×.**
   - The heap holds 268 bytes per live row, but an average row is only 124 bytes.
   - The table has seen 535M inserts and 543M deletes, about 170 full reloads. Free space gets reused, but the table never shrinks.
4. **There's no way to see which queries are expensive.** `pg_stat_statements` isn't installed, so every plan below relies on point measurements.
5. **Two indexes are unused:**
   - `routes (agency_id, route_type)` has had 1 scan.
   - `stops (agency_id, stop_code)` has had 1 scan; search uses the trigram index instead.

   Both still cost writes on every load.

## Changes

1. **`db` command:**

   ```
   -c shared_buffers=768MB
   -c effective_cache_size=2GB
   -c work_mem=8MB
   -c maintenance_work_mem=256MB
   -c max_wal_size=2GB
   -c checkpoint_timeout=5min
   -c random_page_cost=1.1
   -c shared_preload_libraries=pg_stat_statements
   ```

   Keep `synchronous_commit=off` and `wal_writer_delay`. `random_page_cost=1.1` assumes Hetzner's SSD volumes; check with `lsblk -d -o name,rota`.

   **Memory budget:** Postgres about 1.1 GB; app containers about 0.3 GB; Redis capped at 0.25 GB (plan 06); the rest is OS cache.

   **`work_mem`:** it applies per sort or hash node, per connection. With 3 DB services × the default pool of 10 connections, 8 MB is safe.

2. **`mem_limit: 1536m` on `db`,** so a runaway query can't starve the other containers. Confirm it isn't hit with `docker stats` during a load.
3. **Migration:** `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`. Then drop the two unused indexes, and remove their `@Index` declarations from `route.entity.ts` and `stop.entity.ts`. The entity-drift test (plan 08) keeps the two in step.
4. **Reclaim the bloat once,** in a quiet window: `VACUUM (FULL, ANALYZE) stop_times, shapes, trips`. Run it by hand and document it in `docs/deployment.md`; don't put it in a migration.
   - `VACUUM FULL` takes an exclusive lock, so arrivals fail for the minute or two it runs. Do it at about 3 am ET.
   - Alternatively, skip it: the next atomic load after plan 19 rewrites the table compactly anyway.
   - After plan 15, reloads become rare, so the bloat won't come back.

## Verify

- `SHOW shared_buffers;` and the extension list after deploy.
- **Swap time:** compare `Swapped in new GTFS data in Ns` in the ingestion log for the next load with the 257 s baseline.
- **Hit ratio:** `SELECT sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0) FROM pg_statio_user_tables;` should climb toward 0.99.
- **Size after vacuum:** `pg_relation_size('stop_times')` for the heap should fall from 797 MB to about 390 MB (124-byte rows instead of 268). Index bloat wasn't measured; record `pg_indexes_size` before and after.
- Save the top 20 entries of `pg_stat_statements` by `total_exec_time` after a day of traffic. That's the baseline for plans 16–19.
