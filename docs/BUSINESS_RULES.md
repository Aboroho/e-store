# Business Rules

Status: covers Stages 1–2 (foundation, catalog, pricing, inventory, purchasing,
preorders). Stages 3–5 add orders, payments, couriers, exchanges, resellers and
storefront rules in later revisions. Every rule below is enforced in code — most of
them also by a database constraint.

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
