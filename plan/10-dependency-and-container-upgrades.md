# Upgrade dependencies and runtimes; harden containers

**Type:** security
**Touches:** all `package.json` files and the lockfile, all `Dockerfile`s, `docker-compose.yml`, `.github/workflows/ci.yml` (Node version), `.env.example`, `docker/init-db.sql`
**Depends on:** ideally after PR 06 (less duplicated code to touch). Can be split into 10a (backend and runtime), 10b (Next), and 10c (containers and DB role).

## Problem

1. **npm audit:** root lockfile 21 (1 critical, 8 high, 11 moderate, 1 low); frontend 4 (1 critical, 3 high). Raw output: `npm audit --omit=dev --json` in the repo root and `frontend/`.
   - **Next 14.2.35** has about 23 advisories that are fixed only in 15.5.x/16.x, including Server Components and Server Actions DoS (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-m99w-x7hq-7vfj) and SSRF via rewrite/WebSocket. The critical image-optimizer RCE (GHSA-2xp9-vwfh-vxw4) is *probably* not reachable: no `remotePatterns`, and `public/` is empty (unverified).
   - **Nest 10.4.22** pulls in vulnerable body-parser, multer, qs (array-limit bypass DoS) and lodash. The critical `proxy-addr` advisory only matters when `trust proxy` is set, and it isn't.
   - **protobufjs ≤ 7.6.4** comes in via `gtfs-realtime-bindings`. **typeorm** is below 0.3.31.
2. **Node 20 reached end of life in April 2026**, and every Dockerfile and CI uses `node:20-alpine` / Node 20.
3. **Containers:**
   - everything runs as root (no `USER`);
   - services build with `npm install`, not `npm ci`, so the lockfile isn't enforced;
   - the production stage copies the whole root `node_modules`, devDependencies included;
   - `certbot/certbot:latest` is unpinned (`docker-compose.yml:244`);
   - no `mem_limit` anywhere.
4. **Least privilege:**
   - every service connects as the `postgres` superuser;
   - every backend gets the whole `.env` (`env_file: .env`), so vehicles, alerts and agencies get `DATABASE_URL`, and stops and routes get `MBTA_API_KEY`.

   A future SQL injection would then mean superuser access, which allows host-level command execution (`COPY … TO PROGRAM`).
5. **Dev compose** publishes Postgres and an unauthenticated Redis on `0.0.0.0` (`docker-compose.dev.yml:20-21,31-32`). On a laptop on public Wi-Fi, that's an open Redis.

## Changes

1. **10a:**
   - Node 22 LTS (or 24) in all Dockerfiles, CI `setup-node`, and `engines`;
   - Nest 11 (`@nestjs/*`), typeorm ≥ 0.3.31, `npm audit fix` for the rest;
   - `overrides` for `protobufjs` if `gtfs-realtime-bindings` hasn't released a fix.
2. **10b:** Next ≥ 15.5.24 with React 19 and MUI compatibility. Migrate async `params` in `app/**/page.tsx` (Next 15 makes `params` a Promise). Set `images.unoptimized: true`, or disable `/_next/image`, if it isn't used.
3. **10c:**
   - multi-stage `npm ci` → `npm prune --omit=dev` (or `npm ci --omit=dev --workspace <svc>` in the final stage);
   - `USER node`, `read_only: true` plus a `tmpfs: /tmp` where possible;
   - pin `nginx`, `postgis` and `certbot` by digest;
   - `mem_limit` per service.
4. **DB roles:** in `init-db.sql` (or a migration), create `transit_ingest` (DML on the GTFS tables) and `transit_ro` (`SELECT` only). Stops and routes use `transit_ro`. Superuser credentials are only for migrations.
5. **Per-service env:** replace `env_file: .env` with explicit `environment:` lists per service.
6. **Dev compose:** bind `127.0.0.1:5432:5432` and `127.0.0.1:6379:6379`.
7. **CI:** add `npm audit --omit=dev --audit-level=high` as a non-blocking job first, and make it blocking once it's clean. Add Dependabot (`.github/dependabot.yml`) for npm, docker and github-actions.

## Verify

The full CI suite and the cypress groups pass. Run the stack locally, check SSR stop pages and the map, and confirm `docker compose exec stops id` shows a uid other than 0.
