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
   - pin **every** image by digest: each Dockerfile `FROM` (including `node:22-alpine` / `node:24-alpine`, in every stage) and every compose `image:` (`nginx`, `postgis`, `redis`, `certbot`). Keep the tag in the reference for readability (`FROM node:22-alpine@sha256:…`). Any version note goes on its **own line above** the `FROM`: Dockerfiles only treat `#` as a comment at the start of a line, so a trailing `# 22.x` would be parsed as part of the instruction:
     ```dockerfile
     # node 22.x LTS, alpine
     FROM node:22-alpine@sha256:… AS build
     ```
     In compose YAML, a trailing `# …` after `image:` is fine. Dependabot's docker ecosystem (item 7) keeps the digests current;
   - `mem_limit` per service.
4. **DB role matrix.** Every service gets an explicit role, and none uses the superuser:

   | Service | Role | Privileges |
   |---|---|---|
   | `migrate` (one-shot, PR 08) | `transit_owner` | Owns the schema; all DDL, including trigram and other indexes. Not a superuser |
   | `ingestion` | `transit_ingest` | `SELECT, INSERT, UPDATE, DELETE` on the GTFS tables; `TEMPORARY` on the database (PR 07 staging); **no DDL**. Index creation lives in migrations (PR 08), not in ingestion. Post-load `ANALYZE` needs `MAINTAIN` (Postgres 17+); otherwise drop it and rely on autovacuum |
   | `stops`, `routes` | `transit_ro` | `SELECT` only |
   | `agencies` | none today; `transit_ro` once PR 12 reads `last_ingested_at` | `SELECT` on `agencies` only |
   | `alerts`, `vehicles`, `frontend`, `nginx` | no DB credentials | Checked: these services don't use the DB |

   Make the roles (as `NOLOGIN` group roles) and their `GRANT`s, plus `ALTER DEFAULT PRIVILEGES` for future tables, a **versioned, idempotent migration**. Don't put them in `init-db.sql`: it only runs when the Postgres volume is first created, so it would never reach the existing prod DB. Create login users with passwords in a deploy step (`scripts/db/ensure-roles.sh`, an idempotent `DO $$ … IF NOT EXISTS … CREATE ROLE … LOGIN PASSWORD …` run through `psql -v`), so secrets never sit in a migration file. Before restarting services, the deploy checks each service's URL with `psql "$STOPS_DATABASE_URL" -c 'select 1'` and similar, and aborts if one fails.
5. **Per-service env:** replace `env_file: .env` with explicit `environment:` lists per service. Each one gets its own `*_DATABASE_URL` (or none), following the table above. Only `ingestion` gets `MBTA_API_KEY`.
6. **Dev compose:** bind `127.0.0.1:5432:5432` and `127.0.0.1:6379:6379`.
7. **CI:** add `npm audit --omit=dev --audit-level=high` as a non-blocking job first, and make it blocking once it's clean. Add Dependabot (`.github/dependabot.yml`) for npm, docker and github-actions.

## Verify

The full CI suite and the cypress groups pass. Run the stack locally, check SSR stop pages and the map, and confirm `docker compose exec stops id` shows a uid other than 0.
