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

## Stage 3 — Orders, checkout, payments, couriers and exchanges

- Checkout with server-side re-pricing, address snapshots, delivery zone fees, COD surcharge.
- Order lifecycle: PENDING → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → DELIVERED →
  COMPLETED, with reservation → allocation → dispatch and cancellation releasing stock.
- Payments: COD, bKash, SSLCommerz, manual/bank transfer, refunds, `PaymentEvent` webhooks.
- Courier adapters: Pathao, Steadfast, CarryBee (one file per provider operation), shipments,
  tracking webhooks, COD collection records.
- Exchange requests with inspection, restock decisions and difference settlement.
- Outbox + `scripts/worker.ts` for every external call; nothing external inside a transaction.
- Docs: API (REST v1 surface).

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
