# Business Rules

Status: covers **all five stages** — foundation, catalog, pricing, inventory, purchasing,
preorders, orders, payments, couriers, exchanges, resellers, reporting, storefronts, the page
builder, media, reviews, API keys, marketing and plugins. Every rule below is enforced in
code; most of them also by a database constraint.

## 1. Money and quantity

| Rule | Where it is enforced |
| --- | --- |
| All money is stored as integer **paisa** (BDT × 100). No floats anywhere. | `prisma` schema (`Int`), `src/lib/money.ts` |
| Users type BDT; the action layer converts with `Math.round(value * 100)` before validation. | `src/modules/*/actions.ts` |
| Rounding is half-away-from-zero via `formatPaisa`/`weightedAverageCostPaisa`; never `toFixed` on a float. | `src/lib/money.ts` |
| Quantities are integers; fractional units are rejected by validation. | Zod schemas in `src/modules/catalog/schemas.ts` |
| Percentages (tax, commission) are basis points (`1500` = 15%). | `Product.taxRateBps`, `BusinessSetting finance.cod_charge_bps` |

## 2. Catalog

1. **Variants are the sellable unit.** Products are shells for merchandising; stock,
   prices, orders and purchasing all reference a `Variant`.
2. **Every product has at least one variant.** A "simple" product is a single default
   variant, which keeps order and inventory code single-tracked.
3. **Option keys are unique per product.** The server computes the option key from the
   selected attribute values (`attributeSlug:valueSlug|…`) and rejects duplicates with
   a validation error rather than letting the database raise a constraint error.
4. **SKUs are globally unique.** Duplicates inside one form submission are detected
   server-side before insert, with the database unique index as the back stop.
5. **Slugs are unique per business.** Archiving frees the slug for reuse because the
   partial unique index only covers live rows; slug generation therefore checks even
   soft-deleted rows to avoid generating a value the index would reject.
6. **Archiving is guarded, not destructive.** A product cannot be archived while any
   variant still has stock (`onHand`), reservations or open preorder commitments. The
   guard runs inside the transaction that archives it.
7. **Categories form a tree with a materialised `path`.** `path` is
   `parent.path + "/" + slug`; moving a category to one of its own descendants is
   rejected as a cycle, and the path is recalculated for the whole subtree.
8. **Attributes are business-scoped and reusable.** Deleting a category detaches it
   from products instead of deleting the products.

## 3. Pricing

1. **Price resolution order** (`resolveVariantPrice`):
   1. the requested price list, highest `minQuantity` tier that is `<= quantity` and
      within `validFrom`/`validTo`;
   2. the variant's `priceOverridePaisa` when no list item matches;
   3. "no price" — which checkout treats as an error (`requireVariantPrice`) and admin
      screens render as `—`.
2. **Tiers are separate rows.** `(priceListId, variantId, minQuantity)` is unique, so a
   bulk tier never overwrites the base price. Only the base tier (`minQuantity = 1`) of
   the **default** price list mirrors onto `Variant.priceOverridePaisa`, which keeps
   storefront and admin screens consistent without a second lookup.
3. **Compare-at price must not be below the selling price.**
4. **Prices are snapshotted onto order lines** (`unitPricePaisa`, `pricingSource`,
   `priceListId`) when the order is created; changing a price never rewrites history.
5. **Every price change is audited** (`price_list.item_set`).
6. **A catalog requires a default price list.** The seed creates one; product creation
   fails with a clear conflict message if a deployment somehow has none.

## 4. Inventory

1. **The ledger is the truth.** Counters (`onHand`, `reserved`, `damaged`,
   `inspection`, `preorderCommitted`, `incomingQuantity`) are derived from
   `InventoryMovement` rows and only `applyStockMovement()` writes them.
2. **Movements are immutable and idempotent.** A repeated `idempotencyKey` returns the
   original movement and changes nothing.
3. **Availability** = `onHand − reserved − damaged − inspection`. Only availability may
   be sold.
4. **Stock may never go negative**, and `reserved` may never exceed availability.
   Both are CHECK constraints as well as service-level guards.
5. **Damaged and inspection stock sits outside the sellable pool** until an adjustment
   (or, in Stage 3, an inspection decision) moves it.
6. **Weighted average cost** updates only when stock comes in with a unit cost:
   `newAvg = round((oldOnHand × oldAvg + receivedQty × receivedUnitCost) / (oldOnHand + receivedQty))`,
   computed with BigInt to stay exact. Outbound movements never change the average.
7. **Adjustments require a configured, active reason**, honour the reason's direction
   (increase/decrease/both), and require a note when the reason says so. Each adjustment
   writes a movement, a `StockAdjustment` row and an audit entry in one transaction.
8. **One default location per business.** The business is single-warehouse in v1;
   counters are nevertheless keyed by location so a second location does not require a
   schema change (location transfers remain out of scope).

## 5. Purchasing

1. **A purchase order starts as a draft**; submitting it turns outstanding quantities
   into `incomingQuantity` on the balance. Nothing enters stock until a receipt is
   posted.
2. **Only `ORDERED` / `PARTIALLY_RECEIVED` orders can be received**, and never more than
   the outstanding quantity on a line.
3. **A receipt is one transaction**: movement(s), receipt + items, purchase order line
   progress, status transition, audit entry.
4. **Landed cost.** Invoice price + allocated freight/duty form the value that is
   capitalised:
   - Order-level extra cost is capitalised **proportionally to the quantity received**
     across receipts, so a two-part delivery capitalises it exactly once overall:
     `share = floor(extra × quantityReceivedSoFar / orderedQuantity)`.
   - Receipt-level expenses are allocated per line by `QUANTITY` or by `VALUE`
     (proportional, largest-remainder allocation so the parts always sum to the total).
   - The unit cost handed to the weighted average is `floor(lineCostPaisa / quantity)`;
     `GoodsReceiptItem.lineCostPaisa` keeps the exact value used for supplier payables.
   - `NONE` expenses are recorded but not capitalised into stock value.
5. **Idempotent receiving.** Submitting a receipt with an existing `idempotencyKey`
   returns the original receipt (`reused: true`) and books nothing again.
6. **Cancelling an order releases outstanding incoming quantity**; receipts already
   posted are never reversed automatically.
7. **Supplier payments** are recorded against a supplier and optionally a purchase
   order; `paidPaisa` on the order drives the outstanding balance shown in the UI.

## 6. Preorders

1. **A commitment is a promise, not stock.** Creating one increases
   `preorderCommitted`; it never changes `onHand`. Re-creating it for the same order
   line extends the existing commitment (and its counter) instead of duplicating it.
2. **FIFO by priority.** Allocation always serves the oldest `priorityAt` first, then
   `createdAt`. `priorityAt` exists so a queue position can be adjusted (for example
   for a VIP order) without editing timestamps.
3. **Allocation moves a promise into a reservation**: `reserved +qty`,
   `preorderCommitted −qty`, with a `PREORDER_ALLOCATION` movement and a
   `PreorderAllocation` row per commitment.
4. **Allocation can never invent stock.** Allocating more than is physically available
   is rejected by the strict path; the operator-triggered queue allocation serves what
   exists, marks commitments `PARTIALLY_ALLOCATED`/`ALLOCATED`, and reports the
   remainder as `skipped`.
5. **Cancelling a commitment releases both counters** (allocated and unallocated parts)
   and records who cancelled it and why.
6. **Only products/variants that allow preorder** may be sold beyond stock — enforced
   when the order is created in Stage 3.

## 7. Access and audit

1. Every admin page and server action asserts a permission server-side
   (`assertPermission`); navigation only hides what a user cannot use.
2. Owners always have all permissions; roles are permission sets assigned per user.
3. Every financial or stock-affecting change writes an `AuditLog` row in the same
   transaction as the change, including before/after values and the reason.

## 8. Orders and stock (Stage 3)

1. **One order, one transaction.** Customer lookup, price resolution, stock reservation
   (or preorder commitment), totals and the audit row are written together. A failure
   anywhere leaves no half-created order.
2. **The browser never sends money or stock.** Storefront checkout posts variant ids and
   quantities only. Prices come from the price list (variant override → list item →
   storefront list → default list), delivery fees from the zone, and the COD surcharge
   from the zone (falling back to the business setting).
3. **Reservations are the only way to promise a unit.** Available =
   `onHand − reserved − damaged − inspection`. Order creation reserves the units it can
   serve and only turns the shortfall into a preorder promise when the product allows it;
   anything else fails with `INSUFFICIENT_STOCK` instead of overselling.
4. **Dispatch consumes the reservation exactly once**, records a `SALE_DISPATCH`
   movement and queues the courier booking. A second dispatch of the same order is
   refused by the status machine, not by UI state.
5. **Cancelling releases reserved units without restocking** what was never shipped,
   and cancels any preorder promise (releasing both the allocated and the unallocated
   part). Restocking happens only for goods that physically left the warehouse.
6. **Idempotency keys are honoured on creation.** Replaying a key returns the original
   order with `reused: true`; it never reserves a second time.
7. **In-store orders are paid and dispatched in the same transaction** (cash at the
   counter), which is why they need no shipment.

## 9. Payments and refunds (Stage 3)

1. **Recording a payment is separate from receiving one.** `Payment` rows carry the
   method, the provider reference and who recorded them; `PaymentEvent` rows carry every
   provider callback. A callback is applied at most once, keyed by
   `(providerName, providerEventId)`.
2. **A redirect is not a payment.** The callback's amount is checked against the payment
   attempt before any money is recorded; a mismatched amount is stored as an event with
   the reason and does not change the order.
3. **`paidPaisa`, `duePaisa`, `refundedPaisa` and `paymentStatus` are derived** by
   `recalculateOrderPayments` after every money movement — never set by a caller.
4. **Refunds cannot exceed what was paid**, are tracked as
   `REQUESTED → PROCESSING → COMPLETED/FAILED`, and each attempt is stored. Settling a
   refund for an exchange closes the exchange's `refundId`.
5. **Cash on delivery is recorded once per shipment** (`idempotencyKey = cod:<shipmentId>`),
   so a repeated courier webhook or a settlement import cannot double-count the cash.

## 10. Couriers, settlements and exchanges (Stage 3)

1. **One adapter per provider per operation** (`pathao-outgoing-data.ts`,
   `steadfast-outgoing-data.ts`, `carrybee-outgoing-data.ts` plus the client files), all
   behind one interface, so a new courier is a new folder rather than a branch in the
   order service. `MANUAL` has no adapter: those parcels are updated by hand.
2. **Credentials are encrypted at rest** (`IntegrationSecret`), are never sent to the
   browser, and are redacted from logs and error messages.
3. **Webhooks are verified before they are trusted**: HMAC-SHA256 over the raw body with
   the stored secret; the event is stored with `signatureValid` and rejected when the
   signature does not match. Duplicate deliveries are recorded and ignored.
4. **Shipment status has exactly one writer** (`updateShipmentStatus`), which appends
   history and keeps the order's fulfilment status in step; delivery marks the order
   `DELIVERED`.
5. **Settlement rows are matched, never assumed.** A row matches a shipment by tracking
   code or order number and must agree on the expected collection amount; anything else
   lands as `UNMATCHED` with the discrepancy reason and needs a human decision
   (attach / ignore) before the statement can be reconciled.
6. **Statement import is idempotent per `(business, provider, reference)`**, keeps the
   courier's own fee figures onto `CodCollection.netPaisa`, and refuses a second import
   of the same statement.
7. **Exchanges respect the return window** (settings key `exchange.window_days`, default
   7 days from delivery) and can only use items the customer actually bought and has not
   already exchanged.
8. **A return is money, not stock, until it is inspected.** `SELLABLE` goes back to
   `onHand`, `DAMAGED`/`DISCARDED` go to the damaged bucket through an
   `EXCHANGE_RETURN_IN` movement with the reason recorded; replacement units are reserved
   at approval and consumed at completion.
9. **The difference is settled explicitly**: positive → collected from the customer,
   negative → a refund row (so it flows through the same refund pipeline as any other
   refund), zero → nothing.

## 11. Resellers (Stage 4)

- A reseller is a business partner with its own code (`RS-0001`), its own price list
  (`channel = RESELLER`) and an optional login user. Negotiated prices can be set per
  variant, or generated in bulk as a markup in basis points over the default list.
- A reseller order is a normal order with `channel = RESELLER` at the reseller's price.
  The amount the reseller collects from *their* customer
  (`resellerCollectionPaisa`) is recorded on the order and may be changed later; every
  change is written to `ResellerCollectionChange` with who, when and why. The platform
  never caps this amount.
- The amount the reseller owes the platform (`resellerCostPaisa`) is the order total plus
  packaging when the negotiated price does not already include packaging. Earnings
  (`resellerEarningPaisa`) are what the reseller collected minus that cost.
- **Earnings are only payable when the cash is in and reconciled.** Delivering an order
  creates `PENDING` ledger entries. They become `ELIGIBLE` only when the shipment's
  statement row has been matched and the statement taken in, or — for orders paid
  directly — when the order is fully paid. A courier statement that was rejected
  (unmatched or disputed) unlocks nothing.
- The ledger is append-only. A correction is a new entry (`ADJUSTMENT`, `REVERSAL`), never
  an edit. A cancelled order voids its unpaid entries; entries already paid are answered
  with an opposing reversal so the history stays intact.
- Balances are derived from the ledger, never stored: `awaiting settlement`,
  `payable now`, `claimed by a pending payout`, `paid out`.
- **A payout can never exceed the payable balance.** The amount is recomputed from the
  selected ledger entries inside the transaction; the client's number is only a hint.
  One ledger entry can belong to exactly one payout (unique constraint), entries already
  claimed by a pending payout are not offered again, and cancelling a payout releases its
  claims back to the payable pool.
- Amounts below the reseller's minimum (or the business-wide minimum setting) are
  refused rather than silently rounded up.
- Suspending a reseller blocks new orders and payouts; existing orders keep their
  snapshots.

## 12. Reporting (Stage 4)

- Every report is computed from the database at request time. There are no cached
  aggregates to drift.
- Historical reports read the snapshots written on the order line (price, cost, quantity),
  so re-pricing a product never rewrites history.
- **Revenue is not profit.** Reports separate: order revenue, inventory cost of goods
  sold, packaging and fulfilment, courier charges, COD charges, refunds and reseller
  payouts. Reseller payouts are cash movements of margin the platform never booked as
  revenue, so they are reported as a memo line and excluded from gross profit.
- Cost and profit columns require `report.view_cost`; the export applies the same mask.
- Exports are generated by one replaceable engine, are streamed/paginated, always send
  `Content-Disposition: attachment`, and never rely on colour alone to convey a negative
  number (the sign is always printed too).

## 13. Storefronts (Stage 5)

- Several storefronts share **one** catalogue, one customer list, one inventory and one order
  pipeline. A storefront is presentation, pricing and routing only; it never owns stock.
- A request is resolved by `Host`: a `VERIFIED` domain wins, then a slug match, then the default
  `ACTIVE` storefront. Only `ACTIVE` storefronts are served — a suspended or archived storefront
  is a 404, not a hidden listing.
- Product detail and listing pages show the storefront's price list when one is set, then the
  variant override, then the default list. The same server-side resolution the admin uses, so a
  storefront can never be cheaper by client tampering.
- Only published products appear. Availability is derived from the inventory ledger (available,
  reserved, preorder), never from a storefront-local counter.
- Checkout re-resolves prices, delivery zone fees and the COD surcharge on the server; the
  browser submits variant ids and quantities only.
- SEO: canonical URLs, Open Graph data, JSON-LD product offers, `sitemap.xml` (products and live
  pages only) and `robots.txt` (admin, API, cart, checkout and account disallowed) come from the
  database, so no hostname is hard-coded.

## 14. Pages, media and reviews (Stage 5)

| Rule | Where it is enforced |
| --- | --- |
| A page is a validated JSON document (`schemaVersion`, theme, sections, blocks). | `pageDocumentSchema`, `parsePageDocument` |
| Only registered block types render, and only with props that match the block definition. Unknown types and invalid props are rejected on save and skipped on render. | `src/modules/page-builder/blocks.ts`, `block-renderer.tsx` |
| No stored content can execute code or inject markup: there is no `eval`/`new Function`, no `dangerouslySetInnerHTML` from database content, and rendering is React elements only. | page builder renderer |
| Publishing is explicit: a draft is never public, and publishing promotes one immutable version while archiving the previous one. History is never rewritten (restore copies forward). | `publishPage`, `restoreVersion` |
| Saving a draft on a live page does not take it offline. | `saveDraft` keeps `status = PUBLISHED` while a published version exists |
| A media asset referenced by any product, page or review cannot be deleted (only detached with an explicit force). | `MediaUsage` checks in the media service |
| Duplicate uploads are deduplicated by SHA-256 checksum and reuse the same asset. | `requestUpload` |
| Uploads are confirmed server-side (`headObject` + size + content type) before becoming visible; an over-sized or missing object is rejected and cleaned up. | `confirmUpload` |
| Storage credentials never reach the browser; upload/download URLs are signed and time-limited. | signed-URL routes, media manager client |
| One review per customer per purchased product, gated on a delivered/completed order. | `createReview` |
| Image limits (3 images, 50 MB combined by default) are enforced **on the server** from settings. | `reviewImageLimits()` |
| Moderation decides visibility; unapproved reviews are not shown and are not counted in the summary. | `Review.status` |

## 15. API keys, webhooks and marketing (Stage 5)

| Rule | Where it is enforced |
| --- | --- |
| A key secret is generated with 256 bits of entropy, shown once, and only its SHA-256 hash is stored. | `createApiKey`, `ApiKey.keyHash` |
| Every request is checked for status, expiry, IP allowlist and the scope the endpoint declares. An invalid key is an error — never an anonymous request. | `authenticateApiRequest`, `assertScope` |
| A scope can only reveal the data it names: `products:read`, `orders:read`, `orders:write`, `shipments:read`, `customers:read`, `reports:read`. Cost and profit columns stay behind the staff permission and are never exposed through a scope. | route handlers |
| Requests are rate limited per key (120/min) and logged with method, path, status and duration. | `rate-limit.ts`, `ApiRequestLog` |
| Webhook payloads are signed (`sha256=<HMAC of the raw body>`) and deduplicated per `(eventType, dedupeKey)`; retries back off exponentially and stop when the subscription is disabled. | `api-keys/delivery.ts` |
| Marketing events are only sent with consent; without it the row is recorded as skipped, and granting consent later promotes that same row instead of double-counting. | `queueMarketingEvent` |
| Provider credentials stay server-side (encrypted `IntegrationSecret`); only public pixel ids reach the browser, and only for enabled integrations of that storefront. | `storefrontMarketingPixels` |
| Events carry an `event_id` for provider deduplication and no raw personal data (hashed or omitted user data only). | provider payload builders |
| Plugins are a compile-time allowlist: install/enable requires a trusted registry entry, a compatible core version and a valid configuration. Admin-uploaded code is never executed. | `plugins/registry.ts`, `plugins/service.ts` |

## 16. Production readiness (Stage 5)

- Configuration is entirely environment-driven (`src/lib/env.ts` validates at boot); production
  refuses to start with a placeholder secret, a missing `S3_BUCKET` for the `s3` driver or
  `http` cookies. No hostname, credential or provider secret is hard-coded in the source.
- Security headers (CSP, HSTS in production, `X-Content-Type-Options`, `Referrer-Policy`,
  `frame-ancestors`) are set in `next.config.ts`; the CSP trade-off (inline styles/scripts) is
  documented in `docs/SECURITY.md`.
- `/api/health` reports database, storage and worker status for the proxy and the uptime monitor,
  and leaks no versions, counts or configuration.
- Backups, restores, upgrades, rollback and the incident runbook are documented in
  `docs/DEPLOYMENT.md`; the worker runs as its own systemd unit and `/admin/jobs` is the
  operational screen for stuck queues.
- **Production readiness is a checklist, not a claim:** the application is verified here by the
  test suite, the production build and the smoke passes. Provider sandboxes, TLS termination,
  real S3 and off-site backups must be verified on the VPS before go-live (see
  `docs/DEPLOYMENT.md` §Verification).
