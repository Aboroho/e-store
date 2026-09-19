# Architecture

A modular monolith: one Next.js application, one PostgreSQL database, one background worker.
Modules own their tables and expose services; nothing reaches across module boundaries by
importing another module's internals.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ App Router (src/app)                                                 │
│   • React Server Components render data                              │
│   • Server Actions handle form submissions                           │
│   • Route Handlers expose the public REST API under /api/v1          │
├──────────────────────────────────────────────────────────────────────┤
│ UI layer (src/components)                                            │
│   • primitives.tsx (server-safe) · interactive.tsx ("use client")     │
│   • layout/ shell, navigation, icon map                              │
│   • forms/ one client component per form, wired to server actions     │
├──────────────────────────────────────────────────────────────────────┤
│ Modules (src/modules/<name>/{service,actions,schemas,queries}.ts)     │
│   • business rules, permission checks, transactions, audit records    │
├──────────────────────────────────────────────────────────────────────┤
│ Library (src/lib)                                                    │
│   • env, db client, errors, money, crypto, logging, utils             │
│   • auth (password, sessions), permissions, settings, validation      │
│   • audit, rate-limit, idempotency, numbering, api responses          │
├──────────────────────────────────────────────────────────────────────┤
│ Data (Prisma 7 + PostgreSQL 17)                                      │
│   • prisma/parts/*.prisma assembled into prisma/schema.prisma          │
│   • SQL migrations applied by scripts/migrate.mjs                     │
└──────────────────────────────────────────────────────────────────────┘
```

Rules enforced by review and tooling:

- `src/lib/*` never imports from `src/modules/*` (no cycles, no accidental coupling).
- Anything under `src/lib` that touches the database or secrets imports `server-only`, so it can
  never be bundled into a client component.
- Modules never trust client input: every figure a client submits (price, quantity, role, id) is
  re-read or re-derived on the server before it is written.

## 2. Request lifecycle

1. **Proxy** (`src/proxy.ts`, formerly `middleware.ts`) performs a cookie-presence redirect for
   `/admin/*`. It is a convenience gate only.
2. **Server Component / Action** calls `requireSession()`, which resolves the session cookie to a
   database row (hashed token), checks expiry/revocation, and loads the user's roles *and*
   permissions in one query.
3. The page or action calls `assertPermission(session, "permission.key")`. Failure raises
   `AppError(FORBIDDEN)`, which the action turns into a flash message and the API turns into a 403.
4. The service performs the write inside `withTransaction()` when more than one row changes, and
   appends an `AuditLog` row for privileged operations.
5. The response is revalidated (`revalidatePath`) so the UI shows the committed state.

## 3. Data model principles

| Principle | Implementation |
| --- | --- |
| Single business, one inventory location | Every business-owned row carries `businessId`; `InventoryLocation` records the site (the schema supports more, the UI ships one). |
| Money is exact | All amounts are `Int` paisa. The UI parses/validates with `zMoneyPaisa` and formats with `formatPaisa`. No float arithmetic anywhere in the money path. |
| Inventory is a ledger | `InventoryBalance` holds the current counters; `InventoryMovement` is an append-only signed ledger. Counters are never negative (`CHECK` constraints) and every change writes a movement in the same transaction. |
| Idempotency | `IdempotencyRecord` (key + payload hash) guards order creation, payments and webhooks; `dedupeKey`/`providerEventId` uniques guard outbox and webhook replays. |
| Auditing | `AuditLog` is append-only with before/after JSON, actor, IP and request id. |
| Sessions | Staff sessions (`Session`) are separate from customer sessions (`CustomerSession`); both store only a SHA-256 hash of the token. |
| Numbers | `NumberSequence` allocates document numbers atomically inside the caller's transaction. |

Full table list: see `docs/DATABASE_DESIGN.md` (Stage 2) — the schema itself is the source of truth
(`prisma/parts/*.prisma`).

## 4. Authorisation model

- A **permission** is a stable string (`order.update`, `inventory.adjust`, …) defined once in
  `src/lib/permissions/catalog.ts` and seeded into the `Permission` table.
- A **role** is a named set of permissions; seven templates (owner, administrator, inventory staff,
  order staff, customer support, finance, reseller) are seeded per business.
- The **owner** account implicitly holds every permission and cannot be demoted, suspended or
  deleted; the owner role cannot be edited and no other role may hold `*`.
- UI filtering (`can`) is a usability feature; `assertPermission` on the server is the boundary.
  Both read from the same catalogue so they cannot drift.
- Machine clients get a **scope**, not a role: an API key holds a subset of
  `products:read`, `orders:read`, `orders:write`, `shipments:read`, `customers:read`,
  `reports:read`, and `authenticateApiRequest` + `assertScope` check it on every request. A
  staff session that reaches the same route keeps its permission check (`report.view`,
  `order.read`, …) and therefore can never be widened by an API scope.

## 5. Background work

External calls (courier booking, tracking refresh, SMS, email) never run inside a database
transaction. A module writes an `OutboxEvent` in the same transaction as its state change;
`scripts/worker.ts` claims events with `FOR UPDATE SKIP LOCKED`, performs the call, and records the
result. Failures retry with exponential backoff (`30s × 2^attempt`, capped at one hour) up to
`maxAttempts`, then the event is marked `FAILED` and the shipment keeps the provider's message in
`failureReason` so an operator can requeue it from the UI.

The worker is a separate process, so a provider outage can never hold a database transaction open
or block a customer's checkout:

```
admin action ──writes Shipment + OutboxEvent (one tx)──▶ returns immediately
                                          │
                              npm run worker (ClaimsEvent)
                                          │
                     adapter.createShipment() ──HTTP──▶ Pathao / Steadfast / CarryBee
                                          │
                     updateShipmentStatus() + status history + audit (one tx)
```

Provider status comes back the other way: a signed webhook (or the polling refresher) resolves the
shipment by consignment id / tracking code and calls the same `updateShipmentStatus`, which is the
only writer of shipment state — so a webhook, a manual update and a poll cannot disagree.

The same worker drains the two Stage-5 queues, in this order, every tick:

| Queue | Claim | Retry | Dead |
| --- | --- | --- | --- |
| `WebhookDelivery` | due rows with a 5-minute lease (`nextAttemptAt`) | backoff `60s × 2^(n-1)`, cap 6 h, 64 KB payload cap | inactive subscription or unreadable secret |
| `MarketingEvent` | `PENDING`/`FAILED` with `nextAttemptAt` null or past, claimed with `updateMany` | 5 attempts, cap 1 h | integration switched off (row discarded) |
| `OutboxEvent` | `FOR UPDATE SKIP LOCKED` | `30s × 2^attempt`, cap 1 h | no registered handler |

`/admin/jobs` shows all three with their attempt counts, next attempt and last error, which is the
screen the runbook points an operator at when a provider misbehaves.

## 6. Runtime topology

- `npm run dev` / `npm run build && npm start` — the application (port 3000).
- `npm run worker` (continuous) or `npm run worker:once` (cron) — outbox and tracking refresher.
- PostgreSQL 17 (embedded locally, managed service in production).
- Media storage is S3-compatible from Stage 5; the driver can be `disabled`, which makes uploads
  fail loudly instead of pretending to store files.

## 7. Failure handling

- Services throw `AppError` with a stable code (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `INSUFFICIENT_STOCK`, `RATE_LIMITED`, …). Server actions convert these into field
  errors; API routes convert them into the documented JSON envelope.
- Unexpected errors are logged as single-line JSON through `src/lib/logging.ts`, which redacts
  secrets (cookies, tokens, passwords, `Authorization` headers) before writing.
- React error boundaries (`error.tsx`) present a recoverable message with the error digest; the
  full stack stays on the server.

## 8. Reseller, payout and reporting flow (Stage 4)

Resellers are a sales channel, not a second catalogue: an order placed on behalf of a
reseller is the same `Order` row with `channel = RESELLER`, a dedicated price list and
three extra snapshot columns (`resellerCollectionPaisa`, `resellerCostPaisa`,
`resellerEarningPaisa`).

```
order created ─► delivered ─► COD collected ─► statement imported ─► reconciled
     │               │              │                  │                 │
  collection      earnings       codCollection     settlementEntry     ledger entries
  snapshot        snapshot       (per shipment)    status = MATCHED    PENDING → ELIGIBLE
                  PENDING                                              (payout-eligible)
```

Earnings are recorded by `recordResellerEarnings()` inside the delivery transaction and
land in `ResellerLedgerEntry` as an append-only set of entries: one earning credit plus
one debit per charge (packaging, courier, COD). Nothing is ever edited; a cancellation
either voids a not-yet-paid entry or posts an opposing `REVERSAL` entry when the money
has already left the business.

Eligibility is a *derived* property: an entry becomes payable only when the shipment's
own statement row is `MATCHED` and its statement has been taken in
(`RECONCILED`/`PARTIALLY_RECONCILED`) and the COD collection is attached to it. Orders
paid directly (no courier cash) become payable once they are fully paid. The promotion
runs from the settlement import, the manual row resolution and the reconcile action, and
is idempotent.

`resellerBalance()` never stores a balance column. It is computed from the ledger in
three buckets — `pendingPaisa` (awaiting settlement), `eligiblePaisa` (payable now),
`allocatedPaisa` (claimed by a payout that has not been paid yet) — plus `paidPaisa`,
and the three unpaid buckets add up to `outstandingPaisa`.

Payouts are the only writer of `PAID`:

```
createPayout (ELIGIBLE, payoutId = null) ──► entries claimed (payoutId set, still ELIGIBLE)
        │                                              │
        ├─ approvePayout ──► markPayoutPaid ──► entries PAID + ResellerPayoutTransaction
        └─ cancelPayout / failPayout / order cancellation ──► claims released, payout re-costed or cancelled
```

Two guards make a double payout impossible: the amount is always recomputed from the
selected entries (never from a number the client sends), and `ResellerPayoutEntry.ledgerEntryId`
is unique in the database, so one ledger entry can only ever belong to one payout.

### Reports

Reports are pure read queries in `src/modules/reports/queries.ts`. Each returns the same
`ReportResult` shape (`columns`, `rows`, `totals`, `meta`, optional `sections`), which is
what makes one screen, one PDF renderer and one XLSX writer enough for every report. The
export engine (`src/modules/reports/export.ts`) is the only place that formats a report
for download; replacing `pdfkit` or `exceljs` touches that file and nothing else.

The vocabulary is deliberate: **revenue is not profit**. The profit report lists revenue,
inventory cost, packaging, courier charges and refunds as separate lines and only then a
gross-profit total; reseller payouts are shown as a memo line because they move margin
that was never the platform's revenue. Cost and profit columns require
`report.view_cost`, both on screen and in the export.

## 9. Storefront, content, media and integration flow (Stage 5)

The public site is served from `src/app/s/[host]/…`. `src/proxy.ts` (the only edge hook —
`src/middleware.ts` must not exist in Next 16) rewrites a public path onto the host-scoped
route so that storefronts can be resolved from the `Host` header without hard-coding a
domain anywhere:

```
Host: shop.example.com  ──proxy──►  /s/shop.example.com/products/…
      │
      ├─ StorefrontDomain (status = VERIFIED)          → that storefront
      ├─ slug match (first label / dashes)             → that storefront
      └─ otherwise the default ACTIVE storefront       → "matchedBy: default"
```

Nothing in the render path is storefront-specific state: catalogue, customers, inventory,
orders and pricing are the same rows the admin uses. A storefront only chooses a theme,
navigation, pages, a default price list/location and (optionally) its own marketing
integrations. Only `status = ACTIVE` storefronts are served, and a product reachable
through a storefront must be published — a draft product is a 404, not a hidden listing.

### Content

Pages are JSON documents, never markup or code. `pageDocumentSchema` (Zod) validates the
whole tree — `schemaVersion`, theme, sections, blocks — and `block-renderer.tsx` maps each
block `type` to a **registered** React component, validating `props` against the block
definition and skipping anything unknown. There is no `eval`, no `dangerouslySetInnerHTML`
from stored content and no way for an admin to inject JavaScript; the one HTML-ish block
renders a validated, sanitised subset.

```
createPage ─► Page + version 1 (DRAFT, draftVersionId)
saveDraft  ─► new immutable PageVersion (previous draft archived, currentVersion + 1)
              status stays PUBLISHED while a published version exists
publish    ─► draft promoted to PUBLISHED (any prior published version archived)
              draftVersionId cleared, publishedVersionId set
restore v  ─► saveDraft copying v's document forward ("Restored from v n") — history is never rewritten
```

`MediaUsage` rows are synchronised on every save/publish so the media manager can refuse to
delete an asset a page still references.

### Media

The browser never sees a storage credential. `requestUpload()` returns a short-lived signed
target (the same HMAC scheme for the local driver and for S3-compatible stores), the file
goes straight to storage, and `confirmUpload()` verifies the object exists (`headObject`),
size and content type before the asset is published. Uploads are deduplicated by SHA-256
checksum, so the same bytes re-uploaded return the existing asset with `reused: true`.
Deletion checks `MediaUsage` first and only `force: true` detaches it. Object keys are
namespaced per business, and `storageConfigured` settings decide whether private objects are
served through the time-limited download route.

### Reviews, API keys and webhooks

Reviews are one per `(product, customer)` and gated on a `DELIVERED`/`COMPLETED` order;
image count and combined size are enforced **server-side** from settings
(`reviewImageLimits()`), not in the browser. Moderation sets the visible status.

API keys are `esk_<prefix>.<secret>`; only `sha256(plaintext)` is stored (`keyHash`) and the
plaintext is returned once at creation. `authenticateApiRequest` resolves the principal
(Bearer or `X-API-Key`), checks status/expiry/IP allowlist, bumps usage and enforces the
scope — a presented-but-invalid key is an error, never an anonymous request. Webhook
subscriptions store an AES-256-GCM encrypted secret plus its hash; delivery signs the body
with `sha256=<HMAC>` (`verifyPayloadSignature`), sets a delivery dedupe key, caps the payload
at 64 KB and retries with exponential backoff before parking the delivery as `DEAD`.

### Marketing

`queueMarketingEvent()` runs **after** the domain transaction commits and fans out to the
enabled integrations of that storefront (or business-wide ones). Consent is checked first:
without consent the row is recorded as `SKIPPED_NO_CONSENT` rather than sent, and if the
same `(integration, dedupeKey)` pair later arrives with consent the skipped row is promoted
instead of staying blocked by its own dedupe key. Providers are declarative (endpoint
builder + payload mapper); only `META_PIXEL`/`TIKTOK_PIXEL` configurations with a public id
are shipped to the browser, and the server-side ones (META_CONVERSIONS, GOOGLE_ANALYTICS,
CUSTOM) keep their token in `IntegrationSecret` — encrypted, never in a client bundle.

### Plugins

`src/modules/plugins/registry.ts` is a static, explicitly registered list of first-party
extensions (courier adapters, payment providers, the analytics report pack) with a semver
compatibility check against `CORE_VERSION` and a Zod `configSchema` per plugin. Installing
records metadata; enabling requires a trusted registry entry, a compatible version and a
valid configuration. Nothing is fetched or executed at runtime — the registry is a
compile-time allowlist.

## Module map

Each domain module owns its schema validation, service (the only place that writes its
tables), server actions (permission checks + revalidation) and read queries:

```
src/modules/
  catalog/     products, variants, categories, attributes, bulk editing        (queries, service, actions, schemas)
  pricing/     price lists, tiers, price resolution and snapshots
  inventory/   ledger engine, balances, adjustments, stock history
  purchasing/  suppliers, purchase orders, receipts, landed cost, payments
  preorders/   commitments, FIFO allocation, cancellation
  orders/      order lifecycle, dispatch, delivery, cancellation           (Stage 3)
  payments/    payments, provider flows, refunds, COD collection           (Stage 3)
  couriers/    provider adapters, shipments, tracking, charges             (Stage 3)
  settlements/ statement import, matching, reconciliation                  (Stage 3)
  exchanges/   return window, inspection, replacement stock                (Stage 3)
  resellers/   resellers, negotiated pricing, earnings ledger, payouts      (Stage 4)
  reports/     report definitions, database queries, PDF/XLSX export engine (Stage 4)
  storefront/  host resolution, catalogue/theme/nav/page reads, public actions (Stage 5)
  page-builder/ validated page documents, versions, publish/restore, renderer   (Stage 5)
  media/       storage drivers, signed URLs, checksum dedupe, usage tracking    (Stage 5)
  reviews/     purchase gate, moderation, server-side image limits              (Stage 5)
  api-keys/    hashed scoped keys, request logs, webhook subscriptions+delivery (Stage 5)
  marketing/   pixel/conversion providers, consent, queue + retrying delivery   (Stage 5)
  plugins/     trusted registry, install/enable, compatibility + config checks  (Stage 5)
```

Dependency direction is one-way: `catalog → pricing/inventory`, `purchasing →
inventory`, `preorders → inventory`. The inventory engine is the only writer of
`InventoryBalance`/`InventoryMovement`; every other module goes through
`applyStockMovement()` inside its own transaction, which keeps stock, ledger and audit
rows atomic.

```
server action ──► permission check ──► service (transaction) ──► prisma client
     │                                     │
     │                                     ├─ applyStockMovement()  → balances + ledger
     └─ revalidatePath + ActionState       ├─ recordAudit()         → audit log
                                           └─ domain tables         → product/PO/commitment
page (server component) ──► queries module ──► prisma client (read-only, business-scoped)
```
