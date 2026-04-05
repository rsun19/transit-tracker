# Deployment Guide

Production runs on a Hetzner VPS behind nginx with TLS via Let's Encrypt. GitHub Actions builds Docker images, pushes them to GHCR, and deploys on every merge to `main`.

---

## Architecture

```
GitHub Actions CI
  └── build + push → GHCR (ghcr.io/rsun19/transit-tracker-*)
  └── scp → docker-compose.yml, nginx.conf → /opt/transit-tracker/
  └── ssh → docker compose pull && docker compose up -d

Hetzner VPS (Ubuntu 24.04)
  ├── nginx:1.27-alpine       → port 80 (ACME) + 443 (TLS proxy)
  ├── backend (NestJS)        → :3000 (internal)
  ├── frontend (Next.js)      → :3001 (internal)
  ├── worker (NestJS)         → (no port)
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

Create `/opt/transit-tracker/.env` from `.env.production.example`. Required variables:

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

# Create .env from template (fill in your values)
cp .env.production.example /opt/transit-tracker/.env
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
3. Runs `docker compose up -d --remove-orphans`
4. Prunes old images

No manual intervention needed. nginx stays up during rolling restarts because `depends_on: service_healthy` ensures containers are ready before traffic is routed.

---

## TLS Renewal

The `certbot` container runs a renewal loop every 12 hours. Certificates auto-renew when they are within 30 days of expiry. No manual action required.

The cert is stored in the `certbot_certs` Docker named volume on the server. This volume persists across all deploys.

---

## Troubleshooting

### nginx crash-looping

```bash
docker logs transit-tracker-nginx-1 --tail 20
```

**`cannot load certificate ... No such file or directory`** — cert not yet issued. Run the manual certbot bootstrap above.

### backend or frontend unhealthy

```bash
docker inspect transit-tracker-backend-1 --format '{{json .State.Health.Log}}' | python3 -m json.tool
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
