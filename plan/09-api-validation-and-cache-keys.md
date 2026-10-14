# API input validation and cache-key correctness

**Type:** security (DoS hardening) and correctness
**Touches:** `services/stops/src/stops.controller.ts`, `services/routes/src/{routes,trips}.controller.ts`, `alerts.controller.ts`, `vehicles.controller.ts`, the `*.service.ts` cache keys, `packages/shared` (shared zod pipe)
**Depends on:** PR 06 (shared module to put the pipe in), PR 07 (`data_version`)

## Problem

1. **No input validation.** `stops.controller.ts:29-34,57-58` and `routes.controller.ts:16-18` use `parseInt` with no NaN or negative check:
   - `Math.min(NaN, 100)` is `NaN`, which reaches `LIMIT $n` or `.take(NaN)` and gives a 500 with a logged stack trace;
   - `radius=-5` or `radius=abc` passes the check at `:30`;
   - `offset` is unbounded;
   - qs-style array params (`?q[x]=ab`) bypass `q.length < 2` (`:54`).

   There's no `ValidationPipe` anywhere.
2. **LIKE wildcards aren't escaped.** `stops.service.ts:47` and `routes.service.ts:73`: `q=%%` passes the length check and forces a full-scan `COUNT`.
3. **Nearby cache key omits `limit`** (`stops.service.ts:509`). A `limit=1` request caches a one-stop result for that ~110 m cell for 45 s, and everyone nearby gets it. Cache hits also return the first requester's exact `searchCentre` and distances.
4. **Unbounded, long-lived cache keys from user input.** Keys like `cache:stops:routes:{agencyKey}:{stopId}` are cached for 86400 s even when the result is empty (`stops.service.ts:463,489`). Trips and routes use 3600 s (`routes.service.ts:63,104`, `trips.service.ts:34`). Through the port-80 bypass (PR 01) an attacker can mint millions of 24 h keys.
5. **No invalidation after a GTFS reload** (`routes.service.ts:99,196`, `trips.service.ts:90`, `stops.service.ts:489`), so routes and branches stay stale for up to 24 h. Stop search also uses the arrivals TTL constant (`stops.service.ts:169`).
6. **`routes.controller.ts:24-26` returns 404 for a missing `agencyKey`**; it should be 400.

## Changes

1. Add a shared `ZodValidationPipe` and a schema per endpoint:
   - `limit` int 1..100 (default 20);
   - `offset` int 0..10_000;
   - `radius` int 1..5000;
   - `lat` −90..90, `lon` −180..180;
   - `q` a string of 2..100 characters;
   - `agencyKey` must be one of the loaded agency keys (from `AgenciesService`);
   - `stopId`/`tripId`/`routeId` match `/^[\w\-.:\s]{1,100}$/`.

   Invalid input returns 400 with a generic message.
2. Escape `%`, `_` and `\` in LIKE patterns and add `ESCAPE '\'`.
3. Build cache keys from the **validated, normalized** values. Include `limit` in the nearby key, and round the query point to the cache cell so cached responses are consistent.
4. Put the agency's `data_version` (PR 07) in the static-data cache keys, so a reload invalidates them automatically. Cache "not found" or empty results for ≤60 s, not 24 h.
5. Use the right TTL constants. Add `API_CACHE_SEARCH_TTL_S`.
6. Controller unit tests for every bad-input case above (NaN, negative, too large, array param, unknown agency).
