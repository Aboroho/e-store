Continue my e-commerce and inventory management platform. Steps 1 and 2 should already be complete.

Inspect the existing implementation first. Reuse the current database models, services, UI components, authentication, permissions, and inventory logic. Do not replace working modules.

## Goal

Implement the complete order lifecycle, checkout, payment records, courier integrations, customer accounts, and exchanges.

## 1. Order creation

Support these channels:

* Storefront
* In-store
* Admin/staff-created
* Reseller

Orders may contain multiple variants and quantities.

Store immutable snapshots of:

* Product and variant names
* SKU
* Quantity
* Unit price
* Discount
* Packaging cost
* Inventory cost
* Reseller price, when applicable
* Delivery fee
* Extra charges
* Final totals

Support configurable discounts, delivery fees by Bangladesh district, and extra charges with a required label/note.

In-store orders:

* Customer details optional.
* Mark as delivered immediately.
* Do not create courier shipments.

## 2. Inventory reservation and order lifecycle

At order creation:

* Reserve available inventory.
* Create preorder commitments for shortages when preorder is enabled.
* Prevent overselling under concurrent requests.

At dispatch:

* Consume reservations and decrement physical stock exactly once.

At cancellation before shipment:

* Release active reservations.
* Cancel or update preorder commitments.
* Restore stock availability correctly.

Prevent duplicate reservation release, dispatch, payment, or webhook processing.

## 3. Customer checkout and accounts

Implement:

* Cart and checkout.
* Name, phone, district, full address; email optional.
* Configurable checkout fields.
* One shared customer identity across storefronts by normalized phone number.
* Secure verification/account-claim flow.
* Customer order history and status tracking.
* Customer cancellation before shipment.

Never grant account access solely because someone knows or enters a phone number.

## 4. Payments

Implement:

* Cash on delivery
* bKash
* SSLCommerz
* Manual payment recording for authorized staff

Requirements:

* Verify provider callbacks server-side.
* Store payment attempts and provider references.
* Support partial payment, payment failure, refunds, and retries.
* Use idempotency keys.
* Do not mark an order paid based solely on a browser redirect.
* Keep provider credentials server-side.

## 5. Courier integrations

Implement Pathao, Steadfast, and CarryBee in v1.

Create a shared courier interface and separate provider adapter files, for example:

* pathao-outgoing-data.ts
* steadfast-outgoing-data.ts
* carrybee-outgoing-data.ts

Implement:

* Shipment creation and tracking.
* Provider order/tracking IDs.
* Courier charge, COD charge, collected amount.
* Webhook handling and verification.
* Shipment event history.
* Retry handling and idempotency.
* Courier settlement records and reconciliation.

Do not call external courier APIs while holding a database transaction open. Use an outbox/background worker.

## 6. Exchanges

Implement exchanges against eligible delivered orders.

Support:

* Selecting original purchased items.
* Partial quantities.
* Multiple returned and replacement items.
* Configurable exchange window, default 7 calendar days.
* Configurable delivery fee by exchange reason.
* Returned items enter inspection.
* Inspection determines sellable or damaged stock.
* Replacement stock is reserved/consumed through the inventory service.

Calculate:

* Credit from original item price snapshots.
* Charge from current replacement prices.
* Positive difference = collect.
* Negative difference = refund.

Support refund records and provider attempts. Do not implement standalone return-only requests in v1.

## 7. UI

Create:

* Order list and detail
* Order creation
* Customer management
* Checkout
* Payment history
* Shipment tracking
* Courier integration settings
* Settlement reconciliation
* Exchange request/review/processing screens

## 8. Testing

Test:

* Concurrent reservations
* Cancellation and reservation release
* Dispatch exactly once
* Payment callback idempotency
* Courier webhook idempotency
* Partial exchanges
* Exchange price differences
* Refund records
* Settlement reconciliation

## Completion criteria

All order, payment, shipment, and exchange flows must work end to end with real data and authorization. Preserve completed steps. Run lint, type checks, tests, and production build.

Report migrations, configuration, provider setup requirements, test results, and known limitations.

Do not begin Step 4 until this step is reviewed and working.
