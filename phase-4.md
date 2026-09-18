Continue the existing e-commerce and inventory management platform. Steps 1–3 should already be complete.

First inspect and verify the existing implementation. Reuse the established order, inventory, payment, courier, and authorization services. Do not duplicate their business logic.

## Goal

Implement reseller operations, courier settlement reconciliation, reseller payouts, reporting, and operational management.

## 1. Reseller management

Implement:

* Reseller profile and account access.
* Active/inactive status.
* Product visibility and available stock.
* Configurable reseller prices per variant.
* Fallback reseller pricing rules.
* Reseller order creation.
* Reseller-specific packaging-cost inclusion setting.
* Configurable delivery and COD charge rules.
* Reseller order history and earnings dashboard.

Resellers can set their own customer collection amount without a platform-imposed limit, but the amount must be recorded and auditable.

## 2. Reseller earnings

Create an immutable reseller ledger.

Use order snapshots to calculate reseller earnings. Do not calculate historical earnings from current product prices.

Support ledger entries for:

* Earnings
* Packaging charges
* Courier charges
* COD charges
* Adjustments
* Reversals
* Payouts

Critical rule:
**A reseller's earnings are not payable until the corresponding courier COD settlement has actually been received and reconciled by the business.**

Order delivery alone is not sufficient.

Support:

* Partial courier settlements.
* Partial reseller payouts.
* Payouts covering selected eligible orders or ledger entries.
* Outstanding, eligible, paid, and disputed balances.
* Prevention of duplicate settlement allocation and duplicate payout.

Do not permit payout beyond the eligible unpaid balance.

## 3. Courier settlement

Implement settlement reconciliation for Pathao, Steadfast, and CarryBee.

Store:

* Provider settlement reference
* Gross collected amount
* Courier fees
* COD charges
* Net received amount
* Settlement date
* Reconciliation status
* Shipment/order allocations

Reconciliation must be auditable and idempotent.

## 4. Reports

Implement database-backed reports for:

* Sales by date/channel/storefront
* Product and variant sales
* Inventory valuation
* Inventory movement history
* Damaged and inspection stock
* Outstanding preorders
* Purchase history and costs
* Gross profit and configurable packaging/fulfillment costs
* Payment collection and refunds
* Courier charges and settlement differences
* Reseller earnings and unpaid balances

Clearly distinguish:

* Revenue
* Inventory cost
* Packaging/fulfillment expenses
* Courier expenses
* COD charges
* Refunds
* Reseller payouts

Do not label revenue as profit.

## 5. Exports

Implement PDF and formatted XLSX exports for key reports.

Requirements:

* Server/client export engine should be replaceable.
* Use pagination/streaming for large reports.
* Avoid loading huge datasets into memory unnecessarily.
* Provide automatic downloads.
* Use readable tables, totals, dates, and currency formatting.
* Use color-coded indicators where helpful, but do not rely on color alone.

## 6. Operational UI

Create responsive pages for:

* Reseller list/detail
* Reseller price management
* Reseller orders
* Reseller ledger
* Payout creation/history
* Courier settlements
* Reconciliation discrepancies
* Reports and exports

## 7. Testing

Test:

* Settlement received vs merely delivered
* Partial settlement
* Earnings eligibility
* Partial payout
* Duplicate payout prevention
* Ledger reversal
* Report calculations against known fixtures

## Completion criteria

Reseller balances and financial reports must reconcile with underlying ledger records. Existing features must continue working. Run lint, type checks, tests, and production build.

Report implementation, migrations, report definitions, tests, and known limitations.

Do not begin Step 5 until this step is reviewed and working.
