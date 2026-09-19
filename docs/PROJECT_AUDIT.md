# Project audit

Date: 2026-09-19 · Stages 1–2 (foundation/auth/RBAC/admin shell; catalog, pricing, inventory, purchasing, preorders)

This audit records what exists in the repository, what was verified by running it, and what is
still missing. It is updated at the end of every stage.

## 1. What was in the repository when work started

| Item | State |
| --- | --- |
| `master-prompt.md` | 65 KB specification (stack, data model groups A–R, workflows A–L, security, stages). |
| `phase-1.md` … `phase-5.md` | Stage breakdown used as the implementation order. |
| `package.json` / `package-lock.json` | Present, dependencies already listed. |
| Source code | **None** — no `src/`, no Prisma schema, no tests, no configuration. |
| Tooling | No ESLint config, no Vitest config, no CI, no docs folder. |

The repository was therefore a specification-only project: everything below was created in Stage 1.

## 2. Environment constraints discovered

| Constraint | Consequence / workaround |
| --- | --- |
| No access to `binaries.prisma.sh` (TLS disconnect) | The Prisma engine download fails. `prisma generate` runs with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (WASM validator); migrations are authored as SQL and applied by `scripts/migrate.mjs`, which writes a Prisma-compatible `_prisma_migrations` table (sha256 checksums). |
| `apt`/Docker unavailable | PostgreSQL is provided by the npm package `@embedded-postgres/linux-x64` (17.10), started by `scripts/dev-db.sh` on `127.0.0.1:5432`. |
| No `psql` binary in the embedded server | `scripts/pg-admin.mjs` performs database creation and SQL execution through the `pg` driver. |
| Only the npm registry, github.com and pypi are reachable | All dependencies are installed from npm; no CDN-loaded assets are used at runtime. |

## 3. Verification actually performed (Stage 1)

| Check | Command | Result |
| --- | --- | --- |
| Schema validity | `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma validate` | valid — 111 models, 73 enums |
| Client generation | `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate` | 111 model files generated into `src/generated/prisma` |
| Migration applied | `node scripts/migrate.mjs deploy` | `20260918000000_init_platform_schema` applied |
| Schema ↔ database drift | `node scripts/schema-tool.mjs check` | `OK: database matches prisma/schema.prisma` |
| Seed | `npm run db:seed` | 64 districts, 64 permissions, 7 roles, owner account, warehouse, storefront, 64 delivery zones, 5 exchange reasons, 7 number sequences |
| Types | `npx tsc --noEmit` | 0 errors |
| Lint | `npx eslint .` | 0 errors / 0 warnings |
| Tests | `npx vitest run` | 50 passed (45 unit, 5 database integration) |
| Production build | `npm run build` | succeeded (Next.js 16.3.5, 12 routes) |
| Sign-in end-to-end | curl against `next dev` | `/login` 200; `/admin` without cookie → 307 to `/login`; with a session cookie → 200 rendering real dashboard data |

Not yet verified (no environment available in the sandbox): real SMTP delivery, real courier/bKash/
SSLCommerz sandbox calls, S3 bucket uploads, load/performance behaviour.

## 3a. Verification actually performed (Stage 2)

| Check | Command | Result |
| --- | --- | --- |
| Migration applied | `node scripts/migrate.mjs deploy` | `20260919000000_stage2_catalog_inventory` and `20260919000100_fk_referential_actions` applied |
| Schema ↔ database drift | `node scripts/schema-tool.mjs check` | `OK: database matches prisma/schema.prisma` |
| Foreign-key actions | `node scripts/fk-check.mjs` | `Foreign keys OK: 209 constraints match prisma/schema.prisma` |
| Types + lint | `npm run check` | 0 errors |
| Tests | `npx vitest run` | 72 passed (50 unit, 22 database integration) |
| Production build | `npm run build` | succeeded — 31 routes, no build warnings |
| Admin screens | curl with a real session cookie | 12 Stage-2 routes return 200 and render data created through the service layer (product + variants, price list, inventory ledger, adjustment with reason, purchase order with receipt and freight allocation, preorder queue) |

### Defects found and fixed during Stage 2

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **Every foreign key in the initial migration was `ON DELETE SET NULL`**, contradicting the schema. Deleting a business with products failed with `null value in column "productId" of relation "Variant"`, and cascades never ran. | `20260919000100_fk_referential_actions` restores the declared actions (127 CASCADE, 21 RESTRICT, rest SET NULL/NO ACTION); `scripts/fk-check.mjs` prevents a recurrence. |
| 2 | `setPriceListItem` always upserted the `minQuantity = 1` tier, so saving a bulk price overwrote the base price. | Tiers are separate rows again (`minQuantity` is part of the key); only the base tier mirrors onto `Variant.priceOverridePaisa`. Covered by a catalog test. |
| 3 | Receiving a purchase order in parts capitalised the order-level extra cost in full on **every** receipt. | The order's extra cost is now capitalised proportionally to the quantity received, so the total is exact once the order is fully received. Covered by a purchasing test. |
| 4 | Landed unit cost added the allocation remainder to the first line *multiplied by the quantity*, inflating stock value. | Landed value is `quantity × unit cost + allocated expense` (exact); the unit cost used for the weighted average is `floor(lineCost / quantity)`. |
| 5 | Extending a preorder commitment for the same order line updated the commitment but not the `preorderCommitted` counter. | The extension writes a counter movement, keeping ledger and queue consistent. |
| 6 | Allocating more preorder units than were physically available threw instead of reporting the shortfall; the queue path double-counted `skipped`. | The queue action clamps to available stock (`FOR UPDATE`), returns `allocated`/`skipped` correctly, and never reserves stock that is not on the shelf. |
| 7 | The seed created no default price list and no stock adjustment reasons, so a fresh install could not create a product or record an adjustment. | The seed now creates the default price list and 8 adjustment reasons (idempotent). |

## 3b. Verification actually performed (Stage 3)

| Check | Command | Result |
| --- | --- | --- |
| Migration applied | `node scripts/migrate.mjs deploy` | stage-3 DDL applied (order, payment, shipment, settlement, exchange tables) |
| Types + lint | `npm run check` | 0 errors |
| Tests | `npx vitest run` | 101 passed (45 unit, 56 integration) |
| Production build | `npm run build` | succeeded |
| Smoke | curl with a real session cookie | a storefront order placed through the service layer, then 22 admin routes returned `200` with real rows; `/admin/orders` without a cookie redirected to `/login` |

## 3c. Verification actually performed (Stage 4)

| Check | Command | Result |
| --- | --- | --- |
| Types + lint | `npm run check` | 0 errors |
| Tests | `npx vitest run` | 110 passed (45 unit, 65 integration) |
| Production build | `npm run build` | succeeded, all report/export routes present |
| Reports + exports | service + HTTP | all eleven `/admin/reports/<key>` screens `200`; the export endpoint returned a real PDF (`%PDF-` magic) and a real XLSX (PK zip with a `Gross profit` sheet); unknown report `404`, unsupported format `422`, unauthenticated `307` to login |
| Smoke | curl with a real session cookie | reseller, pricing, ledger, payout and report screens rendered the reconciled balances |

## 3d. Verification actually performed (Stage 5)

| Check | Command | Result |
| --- | --- | --- |
| Migration / schema | `node scripts/migrate.mjs deploy`, `node scripts/schema-tool.mjs check` | 3 migrations applied to a **freshly created** database; the database matches `prisma/schema.prisma` (111 models; 112 tables including the migration ledger) |
| Foreign-key actions | `npm run db:check-fk` | `Foreign keys OK: 209 constraints match prisma/schema.prisma` |
| Types + lint | `npm run check` | schema-assembly check, `tsc --noEmit` and `eslint .` all clean (0 errors, 0 warnings) |
| Tests | `npx vitest run` | **137 passed across 16 files** (45 unit, 92 integration) — re-run after rebuilding the environment from a fresh database |
| Production build | `npm run build` | succeeded; every Stage-5 route present (storefront, page builder, media, reviews, API keys, integrations, plugins, jobs, media storage, health) |
| Storefront | `next dev` + curl | `/`, `/products`, `/products/<slug>`, `/cart`, `/robots.txt`, `/sitemap.xml` → `200` without a session; `/pages/<missing>` → `404`; the sitemap listed the seeded product and the newly published page |
| Page builder | service layer + curl | drafted → published → edited → re-published → unpublished through the real service calls; a draft edit was **not** live, the promotion was, and unpublish hid the page; `/admin/pages`, `/admin/pages/new`, `/admin/pages/<id>`, `/admin/pages/<id>/builder` (palette, 13 block types, Save draft/Publish) and `/admin/pages/<id>/preview` → `200` with a session cookie; `/admin/login` → `307` without one |
| Media | integration test against the local driver | signed upload URL → `PUT` → `confirmUpload` published the asset; identical bytes returned `reused: true`; an over-sized object was rejected; delete refused while referenced |

### Defects found and fixed during Stage 5

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `saveDraft` flipped a live page to `DRAFT`, so editing a published page took the storefront page off the air. | `saveDraft` now keeps `PUBLISHED` while `publishedVersionId` is set; only a never-published page stays `DRAFT`. Asserted in `content.test.ts`. |
| 2 | `deliverDueMarketingEvents` selected and claimed `status = "PENDING"` only, so a 503 (`FAILED` with a future `nextAttemptAt`) was never retried. | One shared `due` filter (`PENDING`/`FAILED`, `nextAttemptAt` null or past) for the candidate query **and** the `updateMany` claim. |
| 3 | A conversion skipped for missing consent stayed blocked by its own dedupe key even after the shopper consented, so the purchase was never reported. | `queueMarketingEvent` promotes the existing `SKIPPED_NO_CONSENT` row (records consent, resets attempts) instead of dropping the event. |
| 4 | Storefront product views and checkout starts were not measured at all. | `TrackViewContent`/`TrackInitiateCheckout`/`TrackPurchase` browser events wired into the product page, checkout form and confirmation page, keyed so the server-side `Purchase` deduplicates with them. |

## 4. Known gaps and risks

| # | Gap | Impact | Plan |
| --- | --- | --- | --- |
| 1 | Email delivery is not wired (no SMTP credentials) | Password reset links and invitations cannot be emailed | Password reset stores a single-use token; in non-production the link is returned to the operator. Still open after Stage 5 — SMTP must be configured on the VPS (`docs/DEPLOYMENT.md`). |
| 2 | ~~S3 storage driver is not implemented yet~~ **resolved in Stage 5** | — | `src/modules/media/storage.ts` implements the S3-compatible driver and a local driver behind one interface, with signed time-limited URLs; the sandbox runs the local driver (`STORAGE_DRIVER=local`), so a real bucket still has to be verified on the VPS. |
| 3 | `prisma migrate dev` cannot run offline | New migrations must be authored as SQL | `scripts/schema-tool.mjs sql --out <dir>/migration.sql` generates DDL from the schema; reviewed manually and applied with `scripts/migrate.mjs`. |
| 4 | ~~Covering indexes/FK actions are not compared by the drift checker~~ **resolved in Stage 2** | A hand-edited database could drift silently | `scripts/fk-check.mjs` (`npm run db:check-fk`) now compares all 209 foreign keys with the schema; covering indexes are still not compared (documented as a follow-up). |
| 5 | Navigation advertises later-stage screens | Users could expect features that do not exist | Nav items carry a `stage` field; anything above the current stage renders disabled with an "S5"-style badge instead of a dead link. |
| 6 | No CI pipeline | Regressions rely on the developer running `npm run check` | Still open: the commands are documented as a workflow in `docs/DEPLOYMENT.md` but no `.github/workflows` file is committed, because the sandbox cannot verify a pipeline run. |
| 7 | Provider sandboxes (bKash, SSLCommerz, Pathao, Steadfast, CarryBee) were never called | The adapters are unit-tested against recorded payload shapes, not live APIs | Documented as a go-live checklist item in `docs/DEPLOYMENT.md`; a sandbox round-trip must be run on the VPS. |
| 8 | Browser automation is not part of the suite | Drag-and-drop, keyboard and responsive behaviour were verified by hand | The scripted smoke pass covers routing, rendering and authorization; Playwright is a post-v1 improvement. |

## 5. Repository map (Stage 1)

```
prisma/
  parts/*.prisma            schema sources, assembled into schema.prisma
  migrations/               SQL migrations + extra constraints
  seed.ts, seed/            idempotent seed data
scripts/                    database + schema tooling, schema assembly
src/generated/prisma/       generated client (not committed)
src/lib/                    environment, db, money, crypto, auth, permissions, settings, validation
src/components/             UI primitives, layout shell, forms
src/modules/                auth, users, dashboard, notifications, settings, catalog, pricing, inventory,
                            purchasing, preorders, orders, payments, couriers, settlements, exchanges,
                            resellers, reports, storefront, page-builder, media, reviews, api-keys,
                            marketing, plugins (service + actions + queries per module)
src/app/                    admin area, auth pages, public storefront (`s/[host]`), checkout, health
tests/                      unit tests, database integration tests and shared fixtures
docs/                       audit, architecture, plan, DATABASE_DESIGN, BUSINESS_RULES, TESTING
```
