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

## Stage 5 — Storefronts, page builder, media, reviews, integrations, hardening ✅ complete

| Area | Deliverable | Status |
| --- | --- | --- |
| Storefronts | multi-domain resolution (`src/proxy.ts` rewrites to `/s/{host}`, `StorefrontDomain` → slug → default), per-storefront theme/nav/settings, catalogue + detail + cart + checkout + account + order tracking, JSON-LD, canonical/OG metadata, `sitemap.xml` and `robots.txt` from the database | done |
| Page builder | validated JSON documents (`schemaVersion`, theme, sections, 13 block types), immutable `PageVersion` history, draft → publish → unpublish → restore flow, drag-and-drop canvas with a widget palette, breakpoint preview, live preview route, media picker integration, usage tracking | done |
| Media | S3-compatible driver + local driver behind one interface, signed time-limited upload/download URLs, checksum dedupe, `headObject` confirmation, soft delete with reference checks, folders/search/rename/move, reusable picker for products, pages and reviews | done |
| Reviews | one review per customer per purchased product, delivered/completed gate, rating + title + body, server-enforced image limits (3 images / 50 MB), moderation queue with approve/reject/report handling, star summaries on product pages | done |
| API keys | `esk_` keys stored as SHA-256 hashes, scopes on every request, expiry/revocation/last-used/usage count, IP allowlist, 120 req/min, request log, dual auth (session or key) on the orders and export endpoints | done |
| Webhooks | per-event subscriptions, secret shown once and stored encrypted + hashed, HMAC body signature, 64 KB cap, dedupe per `(eventType, dedupeKey)`, exponential backoff, delivery log and dead-letter state | done |
| Marketing | provider registry (Meta pixel + conversions, TikTok pixel, Google Analytics, custom endpoint), storefront-specific configuration, consent gate + opt-out store, per-integration dedupe with promotion on late consent, browser pixels only for public ids, retrying delivery with logs | done |
| Plugins | static trusted registry (courier, payment, report packs) with semver compatibility and per-plugin config schema, install/configure/enable-disable UI, no execution of uploaded code | done |
| Ops & hardening | `/api/health`, `/admin/jobs` queue screen, CSP + HSTS + security headers, stricter env validation for production, worker draining webhooks + marketing + outbox, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `.env.example` | done |
| Tests | `content.test.ts` (9), `api-keys.test.ts` (12), `marketing.test.ts` (6) — suite now **137 tests / 16 files**, plus the scripted smoke pass over the storefront, page builder and admin screens | done |
| Docs | ARCHITECTURE (§9 + module map), BUSINESS_RULES (§13–16), TESTING (§6), API (keys, webhooks, media URLs, health), SECURITY, DEPLOYMENT, this plan | done |

### Defects found and fixed while testing Stage 5

| Defect | Fix |
| --- | --- |
| `saveDraft` set a live page to `DRAFT`, so editing a published page silently 404'd the storefront | `saveDraft` keeps `PUBLISHED` while a published version exists (the draft is only the next candidate) |
| `deliverDueMarketingEvents` selected and claimed `status = PENDING` only, so a retryable failure never retried | one shared `due` filter (`PENDING`/`FAILED` with `nextAttemptAt` null or past) used by both the candidate query and the claim |
| A conversion skipped for missing consent stayed blocked by its own dedupe key even after the shopper consented | `queueMarketingEvent` promotes the existing `SKIPPED_NO_CONSENT` row instead of dropping the event |
| Storefront product views and checkout starts were never measured | added browser-side ViewContent/InitiateCheckout/Purchase tracking components wired into the product page, checkout form and order confirmation |

## Definition of done for every stage

1. `npm run check` (schema assembly check, `tsc --noEmit`, `eslint .`) passes.
2. `npx vitest run` passes, including new tests for the stage's business rules.
3. `npm run build` succeeds and the running application is exercised manually for the new screens.
4. Migrations apply cleanly to an existing database without data loss.
5. `docs/` is updated, and the stage report lists files, migrations, business rules, tests actually
   run, known limitations and the next step.
