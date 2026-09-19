# Final report — v1 implementation

Scope: everything in `master-prompt.md`, delivered in five stages (`phase-1.md` … `phase-5.md`).
Each stage ended with `npm run check`, `npx vitest run` and `npm run build` green and its own
commit/tag: `stage-1` (`ae8b3ef`), `stage-2` (`0c0de10`), `stage-3` (`b141be1`), `stage-4`
(`a6e2e61`), `stage-5` (`6c777f6`, branch `arena/01a0b5d3-e-store`).

## 1. Features completed

**Foundation (Stage 1).** Single-business setup, email+password authentication with hashed
opaque session cookies, lockout, password policy and reset tokens, a 64-key permission
catalogue with seven role templates and an owner account that cannot be demoted, admin shell
with permission-filtered navigation, audit log, settings, notification bell and dashboard.
111-model Prisma schema, seed, database tooling and drift/FK checkers.

**Catalog, pricing, purchasing, inventory, preorders (Stage 2).** Products and variants with
option-key/SKU validation, categories with materialised paths, attributes, price lists with
quantity tiers and per-channel pricing, an inventory ledger (weighted-average cost, damaged and
reservation counters, adjustments with reasons, low-stock view, history), suppliers, purchase
orders with goods receipts and prorated landed costs, supplier payments, preorder commitments
with FIFO allocation.

**Orders, checkout, payments, couriers, exchanges (Stage 3).** `createOrder` in one transaction
(server-side pricing, reservation, preorder shortfall, zone and COD fees, idempotent replay,
`INSUFFICIENT_STOCK` instead of oversell), order status machine with history, cancellation with
restock, dispatch/courier handover, storefront checkout with rate limiting and guest-order
claiming, COD + bKash + SSLCommerz payments and refunds, three courier adapters
(Pathao/Steadfast/CarryBee) behind one interface with signed webhooks and tracking refresh,
courier statement import and matching, exchanges with inspection and replacement stock.

**Resellers, settlement reconciliation, payouts, reports (Stage 4).** Reseller profiles with
their own price list and negotiated prices, reseller orders with collection snapshots, an
append-only earnings ledger gated on *reconciled COD settlement* (never merely delivered),
partial settlements and partial payouts, payout approval/paid/fail/cancel with a database-level
double-payout guard, 11 database-backed reports, and a replaceable PDF/XLSX export engine with
pagination/streaming, mandatory download headers and cost masking.

**Storefronts, CMS, media, reviews, API, marketing, plugins (Stage 5).**
Multi-storefront/multi-domain public site sharing one catalogue, inventory and customer list;
page builder storing validated JSON documents with immutable version history, draft → publish →
unpublish → restore, drag-and-drop canvas, widget palette, breakpoint preview and a renderer
that only maps registered components; S3-compatible media manager with signed time-limited URLs,
checksum dedupe, folders, search, move/copy, reference-checked delete and a reusable picker;
customer reviews with purchase verification, moderation and server-enforced image limits; scoped
API keys (hash-only, shown once, expiry/revocation/IP allowlist/rate limit/logging) with signed
webhooks, per-event subscriptions, dedupe and retry; marketing integrations (Meta pixel and
server conversions, TikTok pixel, Google Analytics, custom endpoint) with consent handling,
storefront-scoped configuration and delivery logs; a trusted plugin registry with compatibility
and configuration checks; and production readiness (health endpoint, jobs screen, security
headers, hardened env validation, SECURITY/DEPLOYMENT runbooks).

## 2. Important files and modules

| Area | Where |
| --- | --- |
| Domain services | `src/modules/{catalog,pricing,inventory,purchasing,preorders,orders,payments,couriers,settlements,exchanges,resellers,reports}` |
| Stage-5 modules | `src/modules/{storefront,page-builder,media,reviews,api-keys,marketing,plugins}` |
| Core library | `src/lib/{env,db/client,errors,money,crypto,logging,rate-limit,idempotency,audit,settings,validation,api/auth,marketing-client}` |
| Schema | `prisma/parts/*.prisma` → assembled `prisma/schema.prisma`, migrations in `prisma/migrations/` |
| Public site | `src/app/s/[host]/**`, `src/proxy.ts` (host rewrite), `src/app/{sitemap,robots}.ts` |
| Admin | `src/app/admin/**` (43 screens), `src/components/{layout,forms,ui}` |
| HTTP API | `src/app/api/v1/**` (orders, verification, payment callbacks, courier webhooks, report export, media storage), `src/app/api/health` |
| Workers | `scripts/worker.ts` (outbox, webhook delivery, marketing delivery, tracking refresh) |
| Tooling | `scripts/{migrate,schema-tool,assemble-schema,fk-check,dev-db}.mjs|sh` |
| Tests | `tests/lib` (unit), `tests/integration` (database) |

## 3. Database migrations

| Migration | Contents |
| --- | --- |
| `20260918000000_init_platform_schema` | all 111 models (identity/RBAC, settings, catalog, pricing, inventory, purchasing, orders, payments, fulfilment, exchanges, resellers, CMS/media, reviews, integrations/ops) with indexes, uniques and enums |
| `20260919000000_stage2_catalog_inventory` | stage-2 indexes and constraints added after review |
| `20260919000100_fk_referential_actions` | restores the schema's `onDelete` semantics (127 CASCADE, 21 RESTRICT) after the hand-written initial migration set every FK to `SET NULL` |
| `prisma/migrations/extra-constraints.sql` | CHECK constraints (non-negative money/quantities, ranges) applied by `scripts/migrate.mjs` |

Stages 3–5 introduced **no new migration**: their tables shipped in the initial platform
migration, which is why `node scripts/migrate.mjs deploy` on a fresh database is enough. Database
state is verified with `npm run db:check` (schema ↔ database) and `npm run db:check-fk`
(209 foreign keys). No destructive reset is used anywhere.

## 4. Required environment variables

`NODE_ENV`, `APP_URL`, `DATABASE_URL`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `STORAGE_DRIVER`
(plus `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` for `s3`,
or `LOCAL_STORAGE_DIR` for `local`). Optional: `DATABASE_POOL_SIZE`, `S3_PUBLIC_BASE_URL`,
`S3_FORCE_PATH_STYLE`, `S3_PRESIGN_EXPIRES_SECONDS`, `MEDIA_MAX_UPLOAD_MB`, `WORKER_POLL_MS`,
`WORKER_CONCURRENCY`, courier base URLs, `LOG_LEVEL`, seed values, `SHADOW_DATABASE_URL`
(development only). `src/lib/env.ts` validates all of them at boot and refuses to start in
production with development secrets, `http` cookies or an `s3` driver without a bucket. The
committed template is `.env.example`; the real `.env` is git-ignored.

## 5. Deployment instructions (VPS + domain)

Summarised; the step-by-step version with commands is `docs/DEPLOYMENT.md`.

1. Node 22 + PostgreSQL 15+ + nginx (or Caddy) on a 2 vCPU / 4 GB VPS; ≤ $25/month with a small
   VPS plus object storage.
2. `git clone`, `npm ci`, `cp .env.example .env`, generate `SESSION_SECRET` and
   `APP_ENCRYPTION_KEY` with `openssl rand -base64 48`, set `NODE_ENV=production`, the database
   URL, the storage driver and the admin URL.
3. `npm run db:deploy && npm run db:seed` (first install only).
4. `npm run build`, then run the app under systemd (`estore.service` → `npm start`, port 3000,
   bound to 0.0.0.0) and the worker under its own unit (`estore-worker.service` → `npm run worker`).
5. Put nginx in front with TLS (certbot), `client_max_body_size 20m`, and proxy to
   `127.0.0.1:3000`; HSTS and the CSP are set by the application.
6. Point the admin host at `APP_URL` and add storefront domains in
   `/admin/storefronts/<id>` — a domain only serves traffic once it is `VERIFIED`.
7. Verify with `curl -fsS https://<host>/api/health` (database/storage/worker), one test order,
   one worker tick, and `/admin/jobs` empty.

## 6. Backup and restore

```bash
pg_dump --format=custom --file=/var/backups/estore-$(date +%F-%H%M).dump "$DATABASE_URL"
createdb estore_restore && pg_restore --dbname=estore_restore --clean --if-exists /var/backups/estore-*.dump
```

Keep ≥14 daily dumps off the machine (plus the media bucket, which is backed up with the storage
provider's own versioning). **The dump alone is not enough:** `APP_ENCRYPTION_KEY` must be stored
in the same safe place, because every provider/webhook secret is encrypted with it and losing it
makes those rows unreadable (they can only be re-entered, no other data is affected). Restore
procedure, upgrade/rollback and the incident runbook are in `docs/DEPLOYMENT.md` §4, §8, §9.

## 7. Test and build results (actually run)

| Gate | Command | Result |
| --- | --- | --- |
| Schema assembly | `npm run db:assemble:check` | in sync |
| Types | `npm run typecheck` (`tsc --noEmit`) | 0 errors |
| Lint | `npm run lint` (`eslint .`) | 0 errors, 0 warnings |
| Tests | `npx vitest run` | **137 passed / 16 files** (45 unit + 92 integration) against a freshly migrated, seeded PostgreSQL |
| Migrations | `node scripts/migrate.mjs deploy` / `status` | 3 applied, none pending, on a database created from scratch |
| Schema drift | `node scripts/schema-tool.mjs check` | database matches the schema (111 models) |
| Foreign keys | `npm run db:check-fk` | 209 constraints match |
| Production build | `npm run build` | exit 0, 87 app routes (3 static, 84 dynamic) + the proxy |
| Smoke, storefront | `next dev` + HTTP | `/`, `/products`, `/products/<slug>`, `/cart`, `/pages/<slug>`, `/robots.txt`, `/sitemap.xml` → 200; drafts and unknown slugs → 404 |
| Smoke, page builder | service + HTTP | draft → publish → edit → publish → unpublish behaves correctly (a draft edit is never live); builder, preview and admin page screens → 200 with a session, 307 without |
| Smoke, media | integration test | signed upload → PUT → confirm publishes the asset; identical bytes dedupe; oversized refused; delete blocked while referenced |
| Health | `GET /api/health` | 200 with database/storage/worker checks |

Defects found by these tests and fixed in the services are listed in `docs/PROJECT_AUDIT.md`
(§3a–3d) and `docs/IMPLEMENTATION_PLAN.md`; the four Stage-5 ones were: a draft save taking a
live page offline, marketing retries never claiming `FAILED` rows, a consent-blocked conversion
staying blocked after consent, and multi-column page sections rendering n² grid tracks.

## 8. Known limitations and security considerations

* **Not verified against live providers.** bKash, SSLCommerz, Pathao, Steadfast and CarryBee are
  covered by payload/status-mapping tests and a stubbed HTTP layer; no sandbox round-trip was run
  here. Run the sandbox checklist before taking real orders.
* **Real S3 was not exercised.** The suite runs the local driver; the S3 driver shares the same
  signed-URL interface but must be verified against the bucket on the VPS.
* **No browser automation.** Drag-and-drop, keyboard navigation and responsive breakpoints were
  verified by hand; the scripted smoke pass covers routing, rendering and authorization.
* **Email/SMS are not wired** (no SMTP/SMS credentials in this environment): password-reset links
  are stored as single-use tokens and returned to the operator outside production.
* **Single instance.** The worker and the app assume one deployment; the claim queries use
  `FOR UPDATE SKIP LOCKED` (so extra workers are safe), but the local storage driver is not.
* **CI is documented, not committed.** The commands are in `docs/DEPLOYMENT.md`; no
  `.github/workflows` file was added because a pipeline run cannot be verified here.
* Security posture: no secrets in client bundles (only public pixel ids and signed URLs reach the
  browser), CSP/HSTS/`X-Content-Type-Options`/`Referrer-Policy`/`frame-ancestors` set, sessions and
  API keys hashed at rest, provider secrets AES-256-GCM encrypted, webhook payloads HMAC-signed and
  deduplicated, rate limits on login/reset/checkout/order/review/tracking/API, RBAC enforced
  server-side on every action and route, and money as integer paisa everywhere.
* The CSP allows `'unsafe-inline'` for scripts because Next.js hydration needs it; the trade-off
  and a nonce plan are documented in `docs/SECURITY.md`.

**Production readiness is a checklist, not a claim.** Everything that could be verified in this
environment passed (build, migrations, tests, smoke passes, header inspection). Before go-live the
operator must still: create the production database and bucket, set real secrets, complete a
sandbox round-trip per provider, restore a backup once into a scratch database, and confirm TLS
and the health endpoint from outside the network.

## 9. Recommended post-v1 improvements

1. Wire transactional email (SMTP/API) and SMS so password reset, invitations and shipment
   notifications leave the operator's hands.
2. Add Playwright to the pipeline for the storefront journey and the page builder's drag-and-drop,
   plus visual checks of the breakpoints.
3. Add a GitHub Actions workflow running `npm run check`, `npx vitest run` against a PostgreSQL
   service container, and `npm run build` on every push.
4. Extend the drift checker to covering indexes and CHECK constraints, and add a scheduled
   `db:check` in production.
5. S3 lifecycle rules + orphan sweep for unreferenced media, image variants (thumbnails/WebP) and
   uploads resumable from the browser.
6. Multi-location transfers and supplier returns (explicitly out of scope in v1) once the ledger
   and UI can express them safely.
7. Load-test checkout and the worker with production-like volume; add graceful worker shutdown
   metrics and a queue-depth alert.
8. Provider status dashboards (settlement ageing, payout backlog, delivery success rate) built on
   the existing report engine.
9. Nonce-based CSP to drop `'unsafe-inline'`, and CSP reporting to catch regressions.
10. Extend the plugin registry with a signed manifest and an out-of-process contract for
    third-party extensions (never in-process execution).
