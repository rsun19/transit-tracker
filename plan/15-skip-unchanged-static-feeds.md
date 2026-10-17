# Skip static loads when the feed hasn't changed; record every load

**Type:** efficiency, plus a new table
**Touches:** new migration (`gtfs_feed_loads`), `services/ingestion/src/gtfs-static.service.ts`, `ingestion.scheduler.ts`, `packages/shared/src/entities/` (optional entity), `services/agencies` (expose the current feed)
**Depends on:** plan 07 (atomic load) and plan 08 (migrations)

## Problem

1. **Every load rewrites the whole schedule, changed or not.**
   - Production runs `GTFS_INGEST_ON_STARTUP=true`, so every deploy reloads, on top of the 04:00 cron.
   - Each load deletes and re-inserts about 3.1M `stop_times` rows, 395k `shapes` and 118k `trips`. That's about 2.7 GB of table and index writes, plus WAL.
   - `stop_times` has seen 535M inserts, about 170 full reloads (prod, 2026-10-17). Most of them reloaded an identical zip.
2. **The churn costs time and space:**
   - each production load takes about 290 s;
   - it causes the 2.2× bloat in plan 14;
   - every API cache keyed on `data_version` (plan 09) is invalidated even when nothing changed.
3. **There's no record of which feed is loaded.**
   - `agencies.last_ingested_at` and `data_version` say _when_ the last load ran, not _what_ it loaded.
   - When a load is refused (plan 07's row-count guard), the only trace is a log line.
4. **MBTA supports conditional requests.** `GET https://cdn.mbta.com/MBTA_GTFS.zip` returns an `ETag` and `Last-Modified`, and repeating it with `If-None-Match` returns **304** (checked 2026-10-17). `feed_info.txt` has a `feed_version` (e.g. `"Fall 2026, 2026-10-16T20:25:58+00:00, version D"`) and the feed's start and end dates.

## Changes

1. **Migration: `gtfs_feed_loads`**, one row per load attempt:

   | column                                             | type                                      | notes                                         |
   | -------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
   | `id`                                               | `bigserial` PK                            |                                               |
   | `agency_id`                                        | `uuid` FK → agencies, `ON DELETE CASCADE` |                                               |
   | `started_at`, `finished_at`                        | `timestamptz`                             |                                               |
   | `status`                                           | `text`                                    | `loaded`, `unchanged`, `refused`, `failed`    |
   | `etag`, `last_modified`                            | `text`                                    | from the response                             |
   | `sha256`                                           | `char(64)`                                | of the zip, hashed while streaming it to disk |
   | `feed_version`, `feed_start_date`, `feed_end_date` | from `feed_info.txt`                      | nullable; not every feed has it               |
   | `loader_version`                                   | `int`                                     | see 3                                         |
   | `row_counts`                                       | `jsonb`                                   | staged counts per table                       |
   | `data_version`                                     | `int`                                     | `agencies.data_version` after a `loaded` row  |
   | `error`                                            | `text`                                    | for `refused` and `failed`                    |

   Index `(agency_id, started_at DESC)`, plus a partial index `WHERE status = 'loaded'` to find the current feed.

2. **Conditional download.** Take the last `loaded` row for the agency and send `If-None-Match` / `If-Modified-Since` from it.
   - **On 304:** record `unchanged` and stop.
   - **On 200:** hash the zip while writing it. If the `sha256` _and_ `loader_version` match the last `loaded` row, record `unchanged` and stop; some CDNs don't support conditional GETs. Otherwise run the plan 07 load and record the outcome in the same transaction as the swap.
3. **`STATIC_LOADER_VERSION`**, a constant in `gtfs-static.service.ts`. Bump it whenever the loader's output changes (validation rules, derived tables, new columns). A bump forces one reload of an unchanged feed, so a new release never keeps data built by an old loader. Start it at 1.
4. **Force reload:** `GTFS_FORCE_RELOAD=true` ignores 2–3 once. Document it for "the DB looks wrong; reload it".
5. **Startup loads become cheap.** With `GTFS_INGEST_ON_STARTUP=true`, a deploy now costs one 304. The plan 07 swap only runs when MBTA publishes something new, typically a few times a week.
6. **Retention:** keep the last 200 rows per agency; delete older ones after each load.
7. **Expose it:** `GET /api/v1/agencies` adds `feedVersion`, `feedValidUntil` (`feed_end_date`) and `lastCheckedAt`. This covers plan 12's `lastIngestedAt`.
8. **Warn on expiry:** log a warning when `feed_end_date` is less than 7 days away. A feed that expires silently empties the arrivals.

## Tests

- **Integration** (PostGIS, with the fixture server from plan 07's spec):
  - first load → `loaded`;
  - same bytes again → `unchanged`, with no swap and `data_version` unchanged;
  - the server answers 304 → `unchanged`, without downloading;
  - a changed zip → `loaded`;
  - bumping `STATIC_LOADER_VERSION` → `loaded`;
  - a refused feed → a `refused` row and the old data intact.
- **Unit:** `feed_info.txt` parsing, including when it's missing.

## Verify in production

- After a deploy, the ingestion log shows `unchanged (304)` within seconds, and `stop_times` `n_tup_ins` doesn't move.
- `SELECT status, count(*) FROM gtfs_feed_loads GROUP BY 1` after a week: mostly `unchanged`, with `loaded` only on MBTA publish days.
