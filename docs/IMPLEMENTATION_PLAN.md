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

## Stage 4 — Resellers, settlement reconciliation, payouts, reports ✅ complete

| Area | Deliverable | Status |
| --- | --- | --- |
| Resellers | `createReseller` (auto code, own `RESELLER` price list), profile editing, suspend/reactivate, phone/district/payout details, minimum payout and credit limit | done |
| Reseller pricing | negotiated price per variant, per-list minimum quantity, remove override, bulk markup in basis points over the default list | done |
| Reseller orders | `createResellerOrder` (server-side price resolution, packaging rule, delivery/COD charge from the reseller), collection amount snapshot + audited changes | done |
| Earnings | `recordResellerEarnings` inside the delivery transaction: earning credit plus packaging/courier/COD debit lines, per-order snapshot, idempotent per order | done |
| Eligibility | payable only when the shipment's statement row is matched and the statement was taken in (or a directly paid order is settled); promotion from statement import, manual row resolution, reconcile action and the admin refresh button | done |
| Ledger | append-only entries with idempotency keys, void on cancellation, opposing REVERSAL when money already moved, manual adjustments payable immediately, derived balances (pending / payable / claimed / paid) | done |
| Payouts | `createPayout` recomputes the amount from selected entries, minimum checks, approval, paid with a mandatory reference, cancel releases claims, fail, re-cost/cancel after an order cancellation, `ResellerPayoutEntry.ledgerEntryId` unique = database double-payout guard | done |
| Reports | 11 database-backed reports (sales by date/product, inventory valuation/movements/damaged, preorders, purchase history, gross profit, payments, courier charges & differences, reseller earnings) sharing one `ReportResult` shape, cost masking via `report.view_cost` | done |
| Exports | one replaceable engine (`src/modules/reports/export.ts`) rendering PDF (streamed, repeating headers, page numbers) and XLSX (one sheet per table, frozen header, bold totals), mandatory download headers, audited | done |
| UI | resellers list/detail/pricing/ledger, payouts list/new/detail, reports hub + viewer, nav entries, balance tiles that separate "awaiting settlement" from "payable now" | done |
| Tests | `tests/integration/resellers.test.ts` — 9 tests (suite now 110) covering settlement received vs merely delivered, partial settlement, eligibility, partial payout, duplicate payout prevention, ledger reversal and report reconciliation | done |
| Docs | ARCHITECTURE (§7), BUSINESS_RULES (§11–12), TESTING (§5), API (`/api/v1/reports/{key}/export`) | done |

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
