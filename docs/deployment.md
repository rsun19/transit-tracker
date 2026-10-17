# Deployment Guide

Production runs on a Hetzner VPS behind nginx with TLS via Let's Encrypt. GitHub Actions builds Docker images, pushes them to GHCR, and deploys on every merge to `main`.

---

## Architecture

```
GitHub Actions CI
  └── build + push → GHCR (ghcr.io/rsun19/transit-tracker-*)
  └── scp → docker-compose.yml, nginx.conf, nginx/snippets/ → /opt/transit-tracker/
  └── ssh → docker compose pull && docker compose up -d

Hetzner VPS (Ubuntu 24.04)
  ├── nginx:1.27-alpine       → port 80 (ACME + redirect) + 443 (TLS proxy); 8080 internal (SSR API)
  ├── agencies (NestJS)       → :3001 (internal, no DB)
  ├── routes (NestJS)         → :3002 (internal, DB)
  ├── stops (NestJS)          → :3003 (internal, DB)
  ├── alerts (NestJS)         → :3004 (internal, Redis only)
  ├── vehicles (NestJS)       → :3005 (internal, Redis only)
  ├── ingestion (NestJS)      → (no port, DB + Redis)
  ├── frontend (Next.js)      → :3001 (internal)
  ├── db (PostGIS 16)         → :5432 (internal)
  ├── cache (Redis 7)         → :6379 (internal)
  └── certbot                 → renews cert every 12h
```

---

## Prerequisites

### DNS

Both the apex and `www` subdomain must have A records pointing to the server IP **before the first deploy**:

| Type | Name  | Value         |
| ---- | ----- | ------------- |
| A    | `@`   | `<server-ip>` |
| A    | `www` | `<server-ip>` |

Verify propagation:

```bash
dig +short <your-domain> A
dig +short www.<your-domain> A
```

Both should return the server IP.

### GitHub Actions Secrets

Set under **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret            | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `HETZNER_HOST`    | Public IP of the server                                          |
| `HETZNER_USER`    | SSH login username                                               |
| `SSH_PRIVATE_KEY` | Private SSH key (full contents including `-----BEGIN/END` lines) |
| `CERTBOT_EMAIL`   | Email for Let's Encrypt expiry notices                           |

### Server `.env`

Create `/opt/transit-tracker/.env` using the repo's `.env.example` as a template. CI never overwrites this file (it only updates `IMAGE_TAG` and `REGISTRY_OWNER`). Required variables:

| Variable            | Set by | Description                                                           |
| ------------------- | ------ | --------------------------------------------------------------------- |
| `POSTGRES_USER`     | You    | PostgreSQL username                                                   |
| `POSTGRES_PASSWORD` | You    | PostgreSQL password (strong random value)                             |
| `POSTGRES_DB`       | You    | PostgreSQL database name                                              |
| `DATABASE_URL`      | You    | Full connection string: `postgresql://<user>:<password>@db:5432/<db>` |
| `MBTA_API_KEY`      | You    | MBTA v3 API key                                                       |
| `IMAGE_TAG`         | CI     | Injected automatically — git SHA of the commit                        |
| `REGISTRY_OWNER`    | CI     | Injected automatically — GitHub repo owner                            |

---

## First Deploy

1. Add DNS A records (see above) and wait for propagation.
2. Set all four GitHub Actions secrets.
3. SSH into the server and run initial setup:

```bash
# Create app directory
sudo mkdir -p /opt/transit-tracker
sudo chown $USER /opt/transit-tracker

# Log in to GHCR
echo <github-pat> | docker login ghcr.io -u <github-username> --password-stdin

# Create .env — paste in the contents of the repo's .env.example and fill in your values
nano /opt/transit-tracker/.env
```

4. Push to `main` — CI will build images, scp the compose file, and run the deploy script.

### If certbot bootstrap fails

The deploy script tries to issue a certificate automatically. If it fails (e.g. DNS not yet propagated), nginx will crash-loop. Fix manually:

```bash
cd /opt/transit-tracker

# Free port 80
docker compose stop nginx

# Issue cert
docker compose run --rm --publish 80:80 --entrypoint certbot certbot certonly \
  --standalone \
  -d www.<your-domain> -d <your-domain> \
  --email you@example.com \
  --agree-tos --no-eff-email

# Start nginx
docker compose up -d nginx
```

---

## Ongoing Deploys

Push to `main` → CI runs all checks → deploy job:

1. Updates `IMAGE_TAG` in server `.env` to the new git SHA
2. Runs `docker compose pull` to fetch new images
3. Runs `docker compose up -d --wait ingestion`: the one-shot `migrate` service applies pending schema migrations (and exits), then the worker starts. This step must succeed
4. Runs `docker compose up -d --remove-orphans`
5. Prunes old images

`routes`, `stops` and `ingestion` start only after `migrate` exits successfully. If a migration fails or the worker doesn't become healthy, the deploy stops at step 3 and nothing else is updated, so production stays on the previous release; the job log shows the `migrate` output.

### Schema migrations

The schema is owned by TypeORM migrations in `packages/shared/src/migrations/` (listed in `MIGRATIONS`). No service uses `synchronize`. The first migration, `Baseline`, is the production schema as of October 2026: on a database that already has it, it only records itself as run. Take a `pg_dump` before deploying a release that adds a migration.

No manual intervention needed. nginx stays up during rolling restarts because `depends_on: service_healthy` ensures containers are ready before traffic is routed.

---

## Database

Postgres is sized for the 3.8 GB / 3 vCPU / SSD host in `docker-compose.yml`: `shared_buffers=768MB`, `mem_limit: 1536m`, with WAL and checkpoint settings sized for the static load. Changing the `db` command restarts Postgres on the next deploy, which means a few seconds of failed DB requests.

```sh
DB='docker exec transit-tracker-db-1 sh -c'
PSQL='psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Settings in effect
$DB "$PSQL -c \"SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_wal_size')\""

# Slowest queries by total time (pg_stat_statements)
$DB "$PSQL -c \"SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms, left(query, 100) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20\""

# Cache hit ratio (aim for ~0.99)
$DB "$PSQL -c \"SELECT round(sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0), 3) FROM pg_statio_user_tables\""

# Table and index sizes
$DB "$PSQL -c \"SELECT relname, pg_size_pretty(pg_relation_size(relid)) AS heap, pg_size_pretty(pg_indexes_size(relid)) AS indexes FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5\""
```

### Reclaiming table bloat (manual, one-off)

Every static load deletes and re-inserts the whole schedule, so `stop_times` grows to about twice its live size. To shrink it, run this at a quiet time (around 03:00 ET, not near the 04:00 load):

```sh
docker exec transit-tracker-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "VACUUM (FULL, ANALYZE) stop_times, shapes, trips"'
```

`VACUUM FULL` locks each table while it rewrites it, so arrivals and trip pages fail for the minute or two it runs. It isn't automated for that reason. Once loads only run when the feed changes (plan 15), bloat stays low.

---

## TLS Renewal

The `certbot` container runs a renewal loop every 12 hours. Certificates auto-renew when they are within 30 days of expiry. Renewal uses the **webroot** method (nginx serves `/.well-known/acme-challenge/` from the shared `certbot_webroot` volume). The initial bootstrap uses `--standalone` because nginx can't start without a cert, but standalone can't be used for renewals since nginx holds port 80. The renew command passes `--webroot` explicitly to override the saved authenticator.

nginx reloads itself every 6 hours to pick up renewed certs. Each deploy also runs `certbot renew` before restarting nginx.

Let's Encrypt no longer sends expiry reminder emails, so set up an external monitor for certificate expiry (e.g. UptimeRobot or a scheduled `openssl s_client` check).

### Renewing manually

```bash
cd /opt/transit-tracker
docker compose run --rm --entrypoint certbot certbot renew --webroot -w /var/www/certbot
docker compose exec nginx nginx -s reload
```

The cert is stored in the `certbot_certs` Docker named volume on the server. This volume persists across all deploys.

---

## Troubleshooting

### nginx crash-looping

```bash
docker logs transit-tracker-nginx-1 --tail 20
```

**`cannot load certificate ... No such file or directory`** — cert not yet issued. Run the manual certbot bootstrap above.

### microservice or frontend unhealthy

```bash
docker inspect transit-tracker-routes-1 --format '{{json .State.Health.Log}}' | python3 -m json.tool
```

Check the `Output` field of each log entry for the failure reason.

### Containers running old images

```bash
# Force pull and recreate
cd /opt/transit-tracker
docker compose pull
docker compose up -d --force-recreate
```

### Check all container statuses

```bash
cd /opt/transit-tracker && docker compose ps
```

---

## Server Setup (one-time)

Install Docker CE on Ubuntu 24.04 via the official repo:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Add swap (recommended for 2GB RAM servers):

```bash
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
