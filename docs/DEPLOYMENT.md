# Deployment

This is a self-hosted, single-business deployment: one PostgreSQL database, one Next.js
server (Node), one background worker, and object storage. It runs comfortably on a 2 vCPU
/ 4 GB VPS for the volumes this system targets.

Nothing in this document contains a real credential or a hardcoded domain. Copy
`.env.example` to `.env` and fill it in.

## 1. Components

| Process           | Command                  | Notes                                                          |
| ----------------- | ------------------------ | -------------------------------------------------------------- |
| Web application   | `npm start` (port 3000)  | Server actions, pages, `/api/v1`, `/api/health`. Bind 0.0.0.0. |
| Background worker | `npm run worker`         | Outbox, webhooks, marketing conversions, tracking refresh.      |
| PostgreSQL        | system package or managed | Version 15+ (17 used in development).                          |
| Object storage    | S3-compatible or disk    | Courier labels, product and review media.                       |
| Reverse proxy     | nginx / Caddy            | TLS termination, compression, security headers are also set by the app. |

The web app and the worker share the same `.env`. Run exactly one worker with this
volume; the claim queries are safe with more, but one is easier to reason about.

## 2. Requirements

- Node.js 20.9+ (22 LTS recommended), npm 10+.
- PostgreSQL 15+ with a dedicated database and user.
- A domain with DNS pointing at the server (`shop.example.com` for the admin, plus any
  storefront domains — see section 7).
- TLS certificates (Let's Encrypt through certbot or Caddy's automatic HTTPS).

## 3. Configuration

```bash
git clone <your-fork> /srv/estore && cd /srv/estore
cp .env.example .env
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # APP_ENCRYPTION_KEY
```

| Variable                | Required | Meaning                                                                 |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `NODE_ENV`              | yes      | `production` in production. Enables secure cookies, HSTS, secret checks. |
| `APP_URL`               | yes      | Canonical https URL of the admin app. Used in sitemaps and password links. |
| `DATABASE_URL`          | yes      | `postgresql://user:pass@host:5432/estore?schema=public&connection_limit=10` |
| `SHADOW_DATABASE_URL`   | dev only | Only needed for `prisma migrate dev`. Leave empty in production.        |
| `SESSION_SECRET`        | yes      | Session signing. 32+ chars. Rotation invalidates sessions.              |
| `APP_ENCRYPTION_KEY`    | yes      | AES-256-GCM for provider secrets. **Losing it makes stored secrets unreadable** — back it up. |
| `STORAGE_DRIVER`        | yes      | `s3`, `local` or `disabled`.                                            |
| `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` | for `s3` | Bucket credentials. Never expose these to the browser. |
| `S3_PUBLIC_BASE_URL`    | optional | CDN/custom domain for public objects.                                   |
| `S3_FORCE_PATH_STYLE`   | optional | `true` for MinIO and most non-AWS providers.                            |
| `LOCAL_STORAGE_DIR`     | for `local` | Absolute path recommended (`/var/lib/estore/media`) on a persistent disk. |
| `MEDIA_MAX_UPLOAD_MB`   | optional | Upload ceiling (default 15).                                            |
| `WORKER_POLL_MS`        | optional | Idle poll interval, default 2000 ms.                                    |

`env()` validates everything at first read and refuses to start in production with
development secrets, a missing `S3_BUCKET` when `STORAGE_DRIVER=s3`, or a malformed URL.

## 4. Database

```bash
npm ci
npm run db:deploy      # applies committed migrations (never prisma migrate dev in prod)
npm run db:status      # confirms nothing is pending
npm run db:seed        # FIRST INSTALL ONLY: creates the owner, roles, districts, demo data
```

The seed prints the owner email and a password that must be changed after the first
login. Re-running it on a populated database is refused by design.

Backups — do these before every upgrade:

```bash
pg_dump --format=custom --file=/var/backups/estore-$(date +%F-%H%M).dump "$DATABASE_URL"
# restore into a fresh database
createdb estore_restore && pg_restore --dbname=estore_restore --clean --if-exists /var/backups/estore-….dump
```

Keep at least 14 daily dumps off the machine. The dump plus `APP_ENCRYPTION_KEY` is
everything needed to rebuild the instance.

## 5. Object storage

**S3-compatible (recommended).** Any provider works (AWS S3, MinIO, DigitalOcean
Spaces, Backblaze B2 with an S3 endpoint, Cloudflare R2). Create a private bucket and a
key limited to that bucket, then set `STORAGE_DRIVER=s3` plus the `S3_*` values.

```bash
# MinIO example
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=estore -e MINIO_ROOT_PASSWORD='change-me' \
  -v /var/lib/minio:/data quay.io/minio/minio server /data --console-address ":9001"
# then in .env
# STORAGE_DRIVER=s3  S3_ENDPOINT=http://127.0.0.1:9000  S3_FORCE_PATH_STYLE=true
# S3_BUCKET=estore-media  S3_ACCESS_KEY_ID=estore  S3_SECRET_ACCESS_KEY=change-me
```

**Local disk.** Set `STORAGE_DRIVER=local` and an absolute `LOCAL_STORAGE_DIR` on a
persistent volume. Uploads and downloads go through signed URLs issued by the app
(HMAC over operation, key, expiry, content type and disposition). This is fine for a
single-instance install; it does **not** work across multiple app servers.

**Disabled.** `STORAGE_DRIVER=disabled` makes every upload fail with an explanation
instead of silently losing a file. Use it only for a read-only demo.

## 6. Build and run

```bash
npm ci
npm run build          # production build
npm start              # binds 0.0.0.0:3000
```

### systemd — web application

```ini
# /etc/systemd/system/estore.service
[Unit]
Description=E-Store web application
After=network.target postgresql.service

[Service]
Type=simple
User=estore
WorkingDirectory=/srv/estore
EnvironmentFile=/srv/estore/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
# harden a little
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### systemd — background worker

```ini
# /etc/systemd/system/estore-worker.service
[Unit]
Description=E-Store background worker
After=network.target postgresql.service

[Service]
Type=simple
User=estore
WorkingDirectory=/srv/estore
EnvironmentFile=/srv/estore/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now estore estore-worker
journalctl -u estore-worker -f
```

The worker is idempotent: a restart mid-delivery re-reads the lease and retries with
exponential backoff. Dead-lettered rows (`OutboxEvent.status = DEAD`, webhook
`FAILED`/`DEAD`) are visible on `/admin/jobs`.

## 7. Reverse proxy and domains

### nginx + certbot

```nginx
# /etc/nginx/sites-available/estore
server {
  listen 80;
  server_name shop.example.com bazar.example.com;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name shop.example.com bazar.example.com;

  ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;

  client_max_body_size 20m;          # media uploads (app caps them too)

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
    proxy_read_timeout 90s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/estore /etc/nginx/sites-enabled/
sudo certbot --nginx -d shop.example.com -d bazar.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Caddy equivalent: `estore.example.com bazar.example.com { reverse_proxy 127.0.0.1:3000 }`
— automatic HTTPS, same proxy headers.

**Storefront domains.** Point each public storefront's DNS at the server and add it to
the same `server_name` list (or use a wildcard `*.example.com` certificate and a
catch-all server block). Then register the domain under *Admin → Storefronts → Domains*
and mark it verified. The edge proxy resolves the host to a storefront and rewrites
public paths; an unknown or unverified host falls back to the default storefront.

`APP_URL` must match the admin host — it is used for absolute links in sitemaps and the
password-reset path shown to operators when no mail provider is configured.

## 8. Upgrades

```bash
cd /srv/estore
pg_dump --format=custom --file=/var/backups/estore-pre-upgrade.dump "$DATABASE_URL"
git fetch --tags && git checkout <new-tag>
npm ci
npm run db:deploy          # forward-only migrations
npm run build
sudo systemctl restart estore estore-worker
curl -fsS https://shop.example.com/api/health | jq
```

Migrations are forward-only and should be reviewed in the changelog before applying.
Rollback means restoring the dump and checking out the previous tag; keep the previous
`node_modules` and `.next` until the health check passes.

## 9. Operations runbook

| Symptom                                   | First check                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| 502 from the proxy                        | `systemctl status estore`; the app exits on invalid env configuration.       |
| `/api/health` returns 503                 | Database unreachable — check the connection string, disk space, `pg_stat_activity`. |
| Orders not dispatching to couriers        | Worker down (`systemctl status estore-worker`), or `/admin/jobs` shows outbox rows with errors. |
| Webhook subscribers receiving nothing     | `/admin/api-keys` → delivery log; `FAILED` rows retry with backoff, `DEAD` need re-enabling. |
| Marketing conversions missing             | Integration disabled or consent required; `/admin/integrations` shows the skip counter. |
| Uploads failing                           | `STORAGE_DRIVER` and bucket credentials; with local storage check disk space and permissions on `LOCAL_STORAGE_DIR`. |
| Slow admin pages                          | Long report ranges; narrow the range or schedule exports.                   |
| Disk filling up                           | Old media objects and PostgreSQL WAL; the media library supports bulk delete of unused assets. |

Scheduled tasks: nothing outside the worker is required. If you prefer cron over a
long-running worker, `npm run worker:once` processes one batch and exits — run it every
minute.

## 10. Multi-instance notes

- The app is stateless apart from the database and object storage; you may run two
  instances behind the proxy. Session rows live in PostgreSQL, not in memory.
- Only the local storage driver is instance-bound — use S3 for multi-instance.
- Run one worker, or accept that multiple workers will compete for the same claims
  (safe, but the logs get noisy).
