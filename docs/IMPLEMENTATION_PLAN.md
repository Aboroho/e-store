# Implementation plan

Five stages, each ending with a working, reviewable application: lint, type check, tests and a
production build must all pass before the next stage starts. This plan is the working order from
`phase-1.md` … `phase-5.md`, with the concrete file targets for this repository.

## Stage 1 — Foundation, authentication, RBAC, admin shell ✅ complete (commit `ae8b3ef`)

| Area | Deliverable | Status |
| --- | --- | --- |
| Database | 111-model schema in `prisma/parts`, initial migration, CHECK constraints, seed | done |
| Core library | env, db, errors, money, crypto, logging, validation, numbering, rate limiting, idempotency, audit | done |
| Auth | email+password sign-in, session cookies (hashed tokens), lockout, rate limiting, password policy, change/forgot/reset password | done |
| RBAC | permission catalogue (64 keys), role templates, permission checks, protected owner role, users & roles admin | done |
| Admin shell | layout, permission-filtered navigation, notification bell, profile, audit log, settings, dashboard | done |
| Ops | `scripts/` database tooling, schema assembly, drift check, seed, npm scripts | done |
| Tests | unit tests for money/permissions/password/utils + database integration tests for auth | done |
| Docs | PROJECT_AUDIT, ARCHITECTURE, IMPLEMENTATION_PLAN | done |

## Stage 2 — Catalog, pricing, purchasing, inventory and preorders ✅ complete

| Area | Deliverable | Status |
| --- | --- | --- |
| Catalog | Product/variant CRUD with option-key and SKU validation, combination generator, bulk variant editor, archive/restore guards, categories with materialised paths, attributes + starter presets | done |
| Pricing | Price lists per channel with quantity tiers and validity windows, variant override fallback, price snapshots for later stages, price-list editor screens | done |
| Inventory | Ledger engine (`applyStockMovement`) with row locking, idempotency keys, weighted-average cost, damaged/inspection counters, adjustments with reasons, low-stock view, movement history | done |
| Purchasing | Suppliers, purchase orders, submit/cancel, goods receipts with prorated landed costs, supplier payments, payable balances | done |
| Preorders | Commitments, FIFO queue allocation with reservation, cancellation releasing counters | done |
| Admin screens | Products (list/new/detail), categories, attributes, price lists, inventory overview, stock history, adjustments, preorder queue, purchases (list/new/detail), suppliers | done |
| Migration | `20260919000000_stage2_catalog_inventory` + `20260919000100_fk_referential_actions` | done |
| Tooling | `scripts/fk-check.mjs` (`npm run db:check-fk`) proving 209 foreign keys match the schema | done |
| Tests | 11 new integration tests (catalog 5, inventory 7, purchasing 6, preorders 4) — suite now 72 tests | done |
| Docs | DATABASE_DESIGN, BUSINESS_RULES, TESTING | done |

## Stage 3 — Orders, checkout, payments, couriers and exchanges ✅ complete

| Area | Deliverable | Status |
| --- | --- | --- |
| Orders | `createOrder` in one transaction (customer, price resolution, reservation, preorder shortfall, zone fee, COD fee, audit), idempotent replay, `INSUFFICIENT_STOCK` instead of oversell, status machine with history, cancel (release + cancel preorder promise), dispatch (consume reservation, `SALE_DISPATCH`, outbox event), ready-for-courier/delivered transitions | done |
| Checkout | Storefront order placement from variant ids + quantities only, storefront resolution (slug), server-side pricing from the storefront price list, delivery-zone fee and COD fee, rate-limited public server action, guest-order claiming after phone verification | done |
| Payments | `recordPayment`, `initiateProviderPayment`, `processProviderEvent` (atomic, deduped by provider event), bKash and SSLCommerz clients with server-side signature verification, refunds with attempts, COD collection idempotent per shipment, derived `paid/due/refunded` + `paymentStatus` | done |
| Couriers | Adapter per provider per operation (`pathao-outgoing-data.ts`, `steadfast-outgoing-data.ts`, `carrybee-outgoing-data.ts` + clients), `MANUAL` handled without a provider call, encrypted credentials, HMAC-verified webhooks, single status writer with history, tracking refresh, charges | done |
| Outbox worker | `scripts/worker.ts` claims events with `FOR UPDATE SKIP LOCKED`, exponential backoff, dead-letter record, `worker:once` for cron | done |
| Settlements | Statement import with row matching against expected collection, duplicate-reference guard, discrepancy reasons, manual resolve/ignore, reconcile | done |
| Exchanges | Return-window check, partial exchanges, credit/charge maths, replacement reservation at approval, inspection (sellable restock vs damaged bucket), difference collected or refunded | done |
| Admin & account screens | Orders (list/new/detail), payments, customers (list/detail), shipments, couriers & gateways, settlements, exchanges, storefront checkout, customer account (orders + cancel) | done |
| API | `docs/API.md` + `/api/v1/orders`, `/api/v1/orders/{orderNumber}`, `/api/v1/customers/verification`, payment callbacks, courier webhooks | done |
| Tests | 29 new integration tests (orders 11, fulfilment 8, storefront/webhooks 10) — suite now 101 tests | done |
| Docs | API, BUSINESS_RULES (§8–10), TESTING (§4), ARCHITECTURE (§5–6) | done |

## Stage 4 — Resellers, settlement reconciliation, payouts, reports

- Resellers with price lists, per-order earnings, immutable ledger (PENDING → ELIGIBLE → PAID/VOID).
- Courier COD settlement import/reconciliation; earnings become payable only after the settlement
  row is reconciled (`ledgerProcessedAt`).
- Payout runs with entries, approval and immutable history.
- Reports (sales, inventory, profit, reseller, COD) with PDF and XLSX exports.
- Docs: reporting definitions and reconciliation procedure.

## Stage 5 — Storefronts, page builder, media, reviews, integrations, hardening

- Storefront resolution by domain, per-storefront settings, theme tokens, navigation menus.
- Page builder with versioned pages/blocks; SEO fields; sitemap/robots.
- S3-compatible media manager: presigned uploads, variants, folders, usage tracking, orphan cleanup.
- Reviews with verified purchase, moderation, image limits (3 images / 50 MB combined by default).
- Scoped API keys + webhooks with HMAC signatures and replay protection; marketing pixels/consent.
- Plugin registry with declarative hooks only (no arbitrary code execution).
- Production hardening: security headers, rate limits, backup/restore runbook, CI workflow, E2E.

## Definition of done for every stage

1. `npm run check` (schema assembly check, `tsc --noEmit`, `eslint .`) passes.
2. `npx vitest run` passes, including new tests for the stage's business rules.
3. `npm run build` succeeds and the running application is exercised manually for the new screens.
4. Migrations apply cleanly to an existing database without data loss.
5. `docs/` is updated, and the stage report lists files, migrations, business rules, tests actually
   run, known limitations and the next step.
