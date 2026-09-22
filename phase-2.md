Continue implementing my e-commerce and inventory management platform.

Step 1 should already be complete. First inspect the current codebase and verify the existing authentication, permission system, database schema, and UI conventions.

Do not rewrite completed features. Extend the existing architecture.

## Goal

Implement the complete product catalog and inventory foundation, including purchases, stock corrections, and preorder tracking.

## 1. Product catalog

Implement:

* Simple and variable products.
* Product name, slug, description, status, categories, and media references.
* Attributes such as color and size.
* Attribute values and reusable presets.
* Variant combinations, such as Red + XL.
* SKU, barcode, weight, and variant-specific metadata.
* Variant-level overrides of inherited attribute/product defaults.
* Bulk editing of variant data.
* Product search, filtering, sorting, pagination, and archive/delete behavior.

Requirements:

* Each variant combination must be unique within its product.
* SKU must be unique within the business.
* Validate all combinations server-side.
* Prevent deleting variants referenced by historical transactions.
* Use appropriate soft deletion/archive behavior.

## 2. Pricing

Implement:

* Default price list.
* Storefront-specific price lists.
* Configurable product/variant prices.
* Compare-at price.
* Reseller-specific configurable prices.
* Price validation and historical price snapshots.

Do not calculate historical order profitability using current prices.

## 3. Inventory

Implement a single inventory location initially.

Track:

* Physical quantity
* Reserved quantity
* Sellable quantity
* Damaged quantity
* Inspection quantity
* Average inventory cost
* Outstanding preorder quantity

All stock changes must be recorded in an immutable inventory movement ledger.

Support:

* Stock adjustment up/down with mandatory reason.
* Damaged stock correction.
* Inspection stock handling.
* Inventory search and reports.
* Stock history per variant.
* No inter-location transfers in v1.

Do not permit negative physical stock. Preorders may exceed available stock but must be tracked separately.

## 4. Purchase management

Implement:

* Create purchase containing multiple variants.
* Record ordered quantity, received quantity, unit cost, and additional acquisition costs.
* Partial and complete receiving.
* Purchase history and status.
* Atomic stock and average-cost updates on receipt.

Use weighted average cost:

New average cost = (old stock value + received stock value) / (old stock quantity + received quantity).

Use integer paisa or exact decimal arithmetic. Never use floating-point arithmetic for money.

Supplier returns are not supported initially. Stock corrections must not create supplier refunds or credits. Do not require a purchase order to adjust stock.

## 5. Preorders

Allow unlimited preorder quantity when enabled.

When an order exceeds sellable stock:

* Reserve available stock.
* Create a linked outstanding preorder commitment for the shortage.
* Clearly indicate preorder quantity in management screens.
* When new stock arrives, allocate it to the oldest eligible preorder first.
* Prevent the same stock from being allocated twice.
* Track partial allocation and cancellation.

## 6. UI

Create modern responsive pages for:

* Product list/create/edit/detail
* Variant editor and bulk editor
* Attributes and presets
* Categories
* Price lists
* Inventory overview and stock history
* Stock adjustments
* Purchase list/create/detail/receiving
* Preorder queue

Use real database data and server-side authorization.

## 7. Integrity and testing

* Use database transactions for stock operations.
* Use row locking or atomic conditional updates to prevent overselling.
* Prevent duplicate receipt processing.
* Add audit logs for inventory and cost changes.
* Test concurrent stock reservations, partial receipts, weighted average cost, and FIFO preorder allocation.
* Add database constraints through migrations where Prisma cannot express them directly.

## Completion criteria

* Catalog, pricing, purchases, and inventory work end to end.
* Stock totals reconcile with the movement ledger.
* Preorder allocation is FIFO and concurrency-safe.
* Existing Step 1 features continue working.
* Lint, type checks, tests, and production build pass.

Report changed files, migrations, tests, limitations, and any required manual configuration.

Do not begin Step 3 until this step is reviewed and working.
