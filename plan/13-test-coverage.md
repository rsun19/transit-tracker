# Raise test coverage where the risk is

**Type:** tests and CI
**Touches:** `services/*/src/**/*.spec.ts`, `services/ingestion/test/`, `scripts/ci/check-unit-coverage.mjs`, `.github/workflows/ci.yml`
**Depends on:** best done incrementally. Each earlier PR adds its own tests; this PR raises the gates and fills the remaining gaps.

## Current state

- Only `services/stops` has unit tests (3 specs). One tests unused code (`mergeColocatedStops`), and one tests a path that never runs in production (added trips, PR 02 #5).
- The coverage gate is 15% lines, for stops only (`scripts/ci/check-unit-coverage.mjs:7`), with `--passWithNoTests`.
- **Zero tests** for ingestion (the most complex and riskiest code, and the source of both the #35 regression and the "delete db bug"), routes, alerts, vehicles, agencies, or controller validation.
- The `cypress-stops` group is commented out (`ci.yml:120-160`). `test:integration` and `test:contract` exist but don't run in CI.

## Changes

1. **Ingestion:**
   - GTFS-RT parser unit tests with protobuf fixtures (PR 02);
   - static-load integration tests against PostGIS in CI (PR 07).

   Add a *recorded MBTA fixture*: a trimmed real `TripUpdates.pb` plus the matching static subset, refreshed by `plan/tools-analyze-mbta-feed.py`, so there's a regression test that catches the next "realtime silently ignored" bug.
2. **Golden arrival test:** for a fixed fixture and a frozen `Date.now()`, check that `getArrivals('place-alfcl')` returns the exact predicted departure times from the fixture. This test would have caught the #35 regression.
3. **Controllers:** validation tests (PR 09) for every service.
4. **Remove `--passWithNoTests`.** Set a coverage floor per service (start at the current level and ratchet up), with ≥ 60% lines for `ingestion` and `stops`.
5. **Re-enable `cypress-stops`**, or delete it with a note on why. Wire `test:integration` into CI using the Postgres and Redis service containers.
