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
