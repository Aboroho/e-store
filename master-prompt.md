# MASTER IMPLEMENTATION PROMPT

## Complete E-Commerce, Inventory, Order Management, Reseller & Storefront Platform

You are a senior software architect, full-stack engineer, database designer, security engineer, and technical lead.

Your task is to **inspect, architect, implement, test, and document a complete production-ready e-commerce and business management platform**.

This is not a demo, prototype, UI-only project, or collection of disconnected CRUD pages. Build a cohesive, database-backed system with reliable business workflows, strict data integrity, secure authorization, and a modern user interface.

Follow the existing repository structure and conventions wherever practical. Do not rewrite working code unnecessarily.

---

# 1. YOUR FIRST RESPONSIBILITY: INSPECT THE EXISTING PROJECT

Before changing any code:

1. Inspect the complete repository structure.
2. Read the existing `package.json`, configuration files, environment variable examples, database schema, migrations, authentication, middleware, API routes, UI components, and deployment configuration.
3. Identify:

   * Existing framework and versions.
   * Existing application architecture.
   * Existing database and ORM.
   * Existing authentication and authorization.
   * Existing UI component library.
   * Existing business logic and reusable modules.
   * Existing bugs, incomplete features, and architectural limitations.
4. Identify which components can be reused, extended, refactored, or replaced.
5. Do not assume the project is empty.
6. Do not delete or replace working functionality without a clear technical reason.
7. Do not introduce a second database, unnecessary backend, or unrelated framework.
8. Do not create a separate development database. Use the configured PostgreSQL database for application data, including development and production according to the project's environment configuration.
9. Never expose secrets, credentials, or private environment variables in logs, browser code, documentation, or committed files.

Create or update:

* `docs/PROJECT_AUDIT.md`
* `docs/ARCHITECTURE.md`
* `docs/IMPLEMENTATION_PLAN.md`

Document the existing system, identified problems, proposed architecture, and implementation sequence.

If the repository already contains decisions that conflict with this prompt, explain the conflict and choose the least disruptive approach that preserves the business requirements.

---

# 2. PRODUCT VISION

Build a unified business management platform that combines:

* E-commerce storefronts.
* Product catalog and variant management.
* Inventory and stock management.
* Purchasing and receiving.
* Customer management.
* Order management.
* Checkout and payment processing.
* Courier integrations.
* Exchanges and refunds.
* Reseller management.
* Reseller earnings and settlements.
* Financial reporting.
* Storefront page building.
* Media management.
* Product reviews.
* Marketing pixels and conversion events.
* Scoped API access.
* In-app notifications.
* Role-based administration.

The platform must provide a single source of truth for products, inventory, customers, orders, payments, and financial records.

## Business scope

The business initially operates as a single business.

Multiple storefronts and domains may use the same catalog, customer records, pricing configuration, and inventory.

There is no business-switching or multi-tenant management interface in version 1.

The architecture should avoid unnecessary assumptions that would make future expansion impossible, but do not implement multi-tenancy in v1.

## Initial operational constraints

* One Next.js application.
* One business.
* One inventory location.
* No inter-location stock transfers in v1.
* Existing domain and VPS.
* Monthly infrastructure budget below $25 where reasonably achievable.
* AI coding agents will perform most implementation work.
* No unnecessary microservices.
* No unnecessary paid infrastructure.
* No mock business functionality.

---

# 3. REQUIRED TECHNOLOGY AND ARCHITECTURE

Inspect the existing project before selecting versions or replacing technologies.

If the repository does not already establish an appropriate stack, use the following defaults.

## Application

* Next.js App Router.
* React.
* TypeScript with strict mode.
* Tailwind CSS.
* shadcn/ui or an existing equivalent component system.
* Zod for input validation.
* PostgreSQL.
* Prisma ORM.
* REST API under `/api/v1`.
* S3-compatible object storage for uploaded media.
* A modular monolith architecture.

Use server-side code for trusted business operations.

Use client components only when client-side interaction is necessary.

## Architecture principles

1. Modular monolith, not microservices.
2. Business logic separated from presentation.
3. Database transactions for critical workflows.
4. Explicit permissions and authorization.
5. Reusable domain services.
6. Typed API contracts.
7. Shared validation schemas.
8. Idempotent processing for retryable operations.
9. Auditable financial and inventory changes.
10. Database-backed functionality throughout the application.
11. Secure server-side integrations.
12. Documented and tested business rules.

Avoid:

* Massive route handlers containing all business logic.
* Direct database calls scattered throughout UI components.
* Trusting browser-submitted prices or totals.
* Deleting financial history.
* Uncontrolled stock mutations.
* Duplicate payment, shipment, or stock-consumption operations.
* Mock API responses presented as real functionality.
* Overengineering infrastructure beyond actual needs.

---

# 4. REPOSITORY STRUCTURE

Adapt this structure to the existing repository rather than blindly replacing it.

```text
src/
├── app/
│   ├── (public)/
│   │   ├── page.tsx
│   │   ├── products/
│   │   ├── categories/
│   │   ├── cart/
│   │   ├── checkout/
│   │   ├── account/
│   │   └── pages/
│   ├── (auth)/
│   ├── admin/
│   │   ├── dashboard/
│   │   ├── catalog/
│   │   ├── inventory/
│   │   ├── purchasing/
│   │   ├── orders/
│   │   ├── customers/
│   │   ├── payments/
│   │   ├── couriers/
│   │   ├── exchanges/
│   │   ├── resellers/
│   │   ├── settlements/
│   │   ├── finance/
│   │   ├── reports/
│   │   ├── storefront/
│   │   ├── media/
│   │   ├── reviews/
│   │   ├── integrations/
│   │   ├── notifications/
│   │   └── settings/
│   └── api/
│       └── v1/
├── components/
│   ├── ui/
│   ├── layout/
│   ├── forms/
│   ├── tables/
│   ├── dialogs/
│   └── shared/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── catalog/
│   ├── pricing/
│   ├── inventory/
│   ├── purchasing/
│   ├── customers/
│   ├── orders/
│   ├── checkout/
│   ├── payments/
│   ├── couriers/
│   ├── exchanges/
│   ├── resellers/
│   ├── settlements/
│   ├── finance/
│   ├── storefront/
│   ├── page-builder/
│   ├── media/
│   ├── reviews/
│   ├── marketing/
│   ├── api-keys/
│   ├── plugins/
│   └── notifications/
├── lib/
│   ├── db/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   ├── money/
│   ├── dates/
│   ├── errors/
│   ├── logging/
│   ├── storage/
│   └── utils/
├── server/
│   ├── services/
│   ├── repositories/
│   ├── policies/
│   ├── integrations/
│   └── jobs/
├── workers/
├── types/
└── tests/

prisma/
├── schema.prisma
├── migrations/
└── seed.ts

docs/
├── PROJECT_AUDIT.md
├── ARCHITECTURE.md
├── DATABASE_DESIGN.md
├── BUSINESS_RULES.md
├── API.md
├── SECURITY.md
├── DEPLOYMENT.md
├── TESTING.md
└── IMPLEMENTATION_PLAN.md
```

Use module-local services, schemas, types, and tests wherever appropriate.

Do not create empty modules simply to match the folder tree.

---

# 5. DATABASE DESIGN REQUIREMENTS

Design the complete relational database before implementing dependent business workflows.

Produce a complete Prisma schema with:

* All required models.
* All fields and appropriate types.
* All relations.
* All enums.
* Primary keys.
* Foreign keys.
* Unique constraints.
* Check constraints where supported or implemented through migrations.
* Appropriate indexes.
* Nullable versus required fields.
* Referential actions.
* Created and updated timestamps.
* Soft-delete or archival strategy where appropriate.
* Audit fields.
* Transaction and concurrency considerations.

Do not stop at conceptual model names.

**The schema must be detailed enough to generate migrations and support the implemented workflows.**

Use explicit, meaningful model and field names. Avoid unnecessary JSON fields where relational structure is required.

JSON may be used for genuinely flexible snapshots, provider payloads, or page-builder configuration, with validation and versioning.

## Money and precision

Use a consistent money representation.

Prefer integer minor units for currencies where practical, or carefully configured PostgreSQL `Decimal` fields with explicit rounding rules.

Never use JavaScript floating-point arithmetic for financial calculations.

Define currency handling explicitly. The initial business currency is BDT.

## Required model groups

### A. Identity, authentication, and access control

Design models for:

* Users.
* Roles.
* Permissions.
* Role-permission assignments.
* User-role assignments.
* Sessions or refresh tokens, according to the existing authentication approach.
* Password credentials, if applicable.
* Password reset or account recovery.
* Email or phone verification.
* Login and security audit events.

Support customer accounts and staff/admin accounts with appropriate separation of privileges.

Do not rely on hiding UI controls as authorization.

### B. Storefronts and business configuration

Design models for:

* Storefronts.
* Storefront domains.
* Storefront configuration.
* Business settings.
* Checkout configuration.
* Delivery fee configuration.
* Exchange policy configuration.
* Pricing configuration.
* Notification preferences.
* Integration settings.

Multiple storefronts must reference shared products, customers, and inventory.

### C. Catalog and product variants

Design models for:

* Products (primary catalog entity; owns the product SKU and code).
* Product categories and category hierarchy.
* Product-category relationships.
* Product attributes and attribute values (with optional attribute-level price overrides and default media).
* Product attribute assignments.
* Product variants (belonging strictly to a parent product; stable internal identity independently of variant SKU).
* Variant attribute combinations (deterministic option keys).
* Variant images and gallery associations.
* Centralized media manager integration (single primary product image, variant effective image inheritance, gallery ordering).
* Product status and publication state (DRAFT, ACTIVE, ARCHIVED).
* Product slugs (business-scoped uniqueness).
* Product metadata, unit labels, and SEO fields.
* Packaging cost templates and tax rate presets.
* Persistent working drafts and autosave state for product authoring.

Support simple products and variable products with a shared, unified creation and editing UX.

**Architectural Rules for Catalog & Variants:**
* **SKU Ownership:** The SKU belongs to the main product. Variant-specific SKU fields are removed from the management workflow; variants do not require a separate SKU. Variant internal identity remains stable independently of SKU for inventory, orders, and historical records. Product is the primary catalog entity; variants belong to a product and never appear as independent top-level products.
* **Three-Level Property Inheritance:** Manual variant override > Attribute-level override > Product default. This applies to price, cost, images, weight, and preorder flags. Clearing manual overrides restores attribute-level or product-level default inheritance.
* **Product Creation/Editing Flow:** Product creation and editing share the exact same UI workflow structured in sequence:
  1. Product Information (Title/Name, SKU/Product Code, Barcode, Descriptions).
  2. Pricing Defaults (Current Price, Discount Type & Value, Calculated Sell Price, Unit Label).
  3. Product Organization & Configuration (Brand, Categories, Tax Rate Presets, Packaging Cost Templates, Shipping/Weight).
  4. Attributes & Variant Generation (Select attributes, add/remove values with attribute price overrides, generate variant combinations).
  5. Variant Overrides & Bulk Editing (Integrated view of variants, filters, inline overrides, bulk actions dialog, clear overrides — no separate section).
  6. Product Images / Media Gallery (Single primary image, gallery images, reordering).
  7. Remaining Settings & Publishing (SEO, Preorder rules/notes, Status, Save Draft, Publish).
* **Inventory & Purchasing Integration:** No initial-stock-entry option in product creation or editing. All normal product-in stock comes through purchase receiving. Creating a product creates zeroed balances, never stock.
* **Navigation Grouping:** Manage Unit Labels, Tax Rates, Packaging Costs, and Brands grouped cleanly under the Product/Catalog navigation.

Prevent duplicate variant combinations for the same product.

### D. Pricing

Design models for:

* Price lists and price list entries.
* Storefront-specific prices, customer/group prices, and reseller prices.
* Variant-level pricing with 3-level inheritance resolution: Price List -> Manual variant override -> Attribute-level override -> Product default.
* Pricing calculations: Current price, discount (percentage or flat amount), and calculated sell price in integer paisa.
* Discount rules and promotional pricing.

Always calculate order totals and prices server-side; never trust client-submitted prices or totals.

Define the precedence of pricing rules and make it deterministic.

### E. Purchasing and stock receiving

Design models for:

* Suppliers.
* Purchase orders.
* Purchase order items.
* Goods receipts.
* Goods receipt items.
* Purchase cost records.
* Purchase-related expenses, where needed.

A purchase can contain multiple product variants with different quantities and costs.

Receiving stock must create auditable inventory movements.

The system must initially support purchasing and receiving without implementing supplier returns.

### F. Inventory

Design models for:

* Inventory balances.
* Inventory movements.
* Stock reservations.
* Reservation allocations.
* Preorder commitments.
* Stock adjustments.
* Stock adjustment reasons.
* Stock condition/status.
* Inventory audit history.

The inventory model must distinguish:

* Physical stock.
* Sellable stock.
* Reserved stock.
* Damaged stock.
* Stock awaiting inspection.
* Stock committed to preorders.
* Stock available for new orders.

Define these concepts mathematically in `docs/BUSINESS_RULES.md`.

Do not allow negative physical stock.

Do not let two concurrent orders reserve the same available stock.

Do not use an untracked direct update to inventory as the normal stock-changing mechanism.

Every stock mutation must have a source, reason, timestamp, and auditable movement record.

### G. Customers

Design models for:

* Customers.
* Customer phone numbers or normalized identity.
* Customer addresses.
* Customer account claims or verification.
* Customer notes.
* Customer activity or audit records.

The same normalized phone number identifies the same customer across storefronts.

Support optional customer email.

Avoid collecting unnecessary personal data.

### H. Orders

Design models for:

* Orders.
* Order items.
* Order item snapshots.
* Order status history.
* Order adjustments.
* Order discounts.
* Delivery charges.
* Extra charges with notes.
* Order addresses.
* Order source/channel.
* Order cancellation.
* Order fulfillment.
* Order shipment records.

Orders may originate from:

* Storefront customers.
* Admin or authorized staff.
* Resellers.
* In-store sales.

An order can contain multiple variants.

Preserve product name, SKU, selected variant, price, and relevant product details as historical snapshots.

Changes to a product must not rewrite old order history.

### I. Payments and refunds

Design models for:

* Payment records.
* Payment attempts.
* Payment provider references.
* Payment events.
* Payment allocations.
* Refunds.
* Refund attempts or provider references.
* COD collections.
* Payment reconciliation records.

Support:

* Cash on delivery.
* bKash.
* SSLCommerz.
* Partial payments.
* Multiple payment attempts.
* Refund tracking.

A browser redirect is not proof of payment.

Verify payment status using trusted server-side provider verification or authenticated callbacks.

Use idempotency and unique provider references to prevent duplicate financial records.

### J. Courier integrations

Design models for:

* Courier providers.
* Courier configuration.
* Courier shipments.
* Courier tracking identifiers.
* Courier status history.
* Courier charge records.
* COD collection records.
* Courier webhook events.
* Settlement records.
* Reconciliation entries.

Initial providers:

* Pathao.
* Steadfast.
* CarryBee.

Each provider must have an isolated adapter and provider-specific outgoing payload mapping.

Use clear, separately maintained files such as:

`pathao-outgoing-data.ts`

Follow the same pattern for other providers.

Do not mix provider-specific request fields throughout order business logic.

### K. Exchanges

Design models for:

* Exchange requests.
* Exchange items.
* Original order item references.
* Replacement order item references.
* Exchange shipment records.
* Returned item inspection.
* Exchange financial adjustments.
* Exchange status history.

Support partial exchanges and multiple item exchanges against delivered orders.

The database must preserve which original quantity was exchanged and which replacement items were supplied.

Do not implement a standalone return-only workflow in v1.

### L. Resellers

Design models for:

* Reseller accounts.
* Reseller pricing.
* Reseller orders.
* Reseller order details.
* Customer collection amounts.
* Reseller earnings.
* Earnings ledger entries.
* Courier COD settlement allocations.
* Reseller payout batches.
* Payout entries.
* Payout transactions.
* Payout audit history.

Support configurable reseller pricing per variant.

Resellers may choose the amount collected from their customers, subject to validation and audit requirements.

Support configurable packaging-cost inclusion.

Reseller earnings must not become payable merely because an order is delivered.

They become eligible only after the courier COD settlement is actually received and reconciled.

Support partial settlement and partial payouts.

### M. Finance and reporting

Design models or reliable derived ledgers for:

* Revenue.
* Inventory cost.
* Packaging costs.
* Fulfillment expenses.
* Courier charges.
* COD charges.
* Discounts.
* Extra charges.
* Refunds.
* Reseller earnings.
* Reseller payouts.
* Payment reconciliation.
* Financial adjustments.

Do not treat order revenue, cash received, courier settlement, and reseller payable as the same financial concept.

Document accounting assumptions and calculations.

### N. Media

Design models for:

* Media assets.
* Folders.
* Media references or associations.
* Upload metadata.
* Storage provider.
* Object key.
* File size.
* MIME type.
* Image dimensions, where available.
* Alt text.
* Ownership and access metadata.

All uploaded files must use S3-compatible storage.

Do not store uploaded binary files directly in PostgreSQL.

### O. Storefront and page builder

Design models for:

* Pages.
* Page versions.
* Page-builder configuration.
* Reusable sections or templates.
* Navigation menus.
* Storefront themes.
* SEO metadata.
* Publication status.
* Draft and published revisions.

Use a versioned, validated page-builder document structure.

### P. Reviews

Design models for:

* Product reviews.
* Review images.
* Review moderation.
* Review status.
* Review ownership and purchase verification.

### Q. Integrations and API access

Design models for:

* API keys.
* API key scopes.
* API key expiry and revocation.
* API access logs, where appropriate.
* Marketing integrations.
* Pixel configuration.
* Consent records.
* Server-side event delivery.
* Integration delivery attempts.
* Plugin registry and configuration.

### R. Notifications and auditing

Design models for:

* In-app notifications.
* Notification recipients.
* Notification read status.
* Related entity references.
* Audit logs.
* Background job records.
* Webhook processing records.
* Outbox events.

Notifications must link to their related content.

No push notifications are required in v1.

---

# 6. CRITICAL DATABASE AND TRANSACTION RULES

Before implementing workflows, document the transaction boundaries and invariants.

## Inventory consistency

Define exactly how the system calculates:

* Physical stock.
* Sellable stock.
* Reserved stock.
* Preorder commitments.
* Damaged stock.
* Inspection stock.
* Available stock.

The calculation must remain consistent across receiving, reservation, cancellation, dispatch, exchanges, and adjustments.

Use database transactions and appropriate locking or conditional updates for concurrent operations.

Prevent duplicate stock consumption.

Use immutable or auditable inventory movement records.

## Idempotency

Use idempotency for operations that may be retried, including:

* Payment callbacks.
* Courier webhooks.
* Shipment creation.
* Stock consumption.
* Refund processing.
* COD settlement imports.
* Reseller payout processing.
* Background job execution.

Repeated delivery of the same event must not create duplicate financial or inventory effects.

## Financial consistency

Every financial operation must have a defined source, amount, status, and audit trail.

Do not silently overwrite completed financial transactions.

Use reversals or compensating entries when correction is necessary.

## Historical integrity

Order and financial snapshots must remain historically accurate even when catalog, pricing, customer, or courier configuration changes.

## Database constraints

Use unique constraints and indexes to enforce important business invariants at the database level whenever possible.

Do not rely only on frontend validation.

---

# 7. AUTHENTICATION, AUTHORIZATION, AND SECURITY

Implement secure authentication using the existing project approach, unless it is unsuitable.

Support:

* Admin/staff login.
* Customer registration or account claim.
* Secure password setup.
* Customer identity verification.
* Session management.
* Logout.
* Password recovery where applicable.

## Customer identity

A normalized phone number identifies a customer across storefronts.

Provide a secure passwordless account-claim or verification flow.

Customers may set a password after verification.

Do not allow someone to claim another person's account merely by submitting their phone number.

Use appropriate verification, expiration, attempt limits, and rate limiting.

## Authorization

Implement role-based and permission-based access control.

Enforce permissions on the server for every protected action.

Support least-privilege roles for:

* Owner/super administrator.
* Admin.
* Inventory staff.
* Order staff.
* Customer support.
* Finance staff.
* Reseller.
* Customer.

Define permissions granularly.

Examples:

* View orders.
* Create orders.
* Cancel orders.
* Edit catalog.
* Receive stock.
* Adjust stock.
* View costs.
* View payments.
* Process refunds.
* Reconcile courier settlements.
* Approve reseller payouts.
* Manage users.
* Manage integrations.

A user must not gain access to an operation simply because a button is hidden or a page is inaccessible.

## Security controls

Implement:

* Server-side validation.
* Secure session cookies.
* CSRF protections where applicable.
* Rate limiting.
* Brute-force protection.
* Secure secret management.
* Input sanitization.
* Upload validation.
* API key hashing.
* Permission checks for media.
* Safe webhook verification.
* Audit logging.
* Protection against unauthorized object access.
* Secure error handling.
* No sensitive data in client bundles or logs.

Do not expose provider credentials, API secrets, or internal financial data to unauthorized users.

---

# 8. PRODUCT CATALOG AND VARIANT MANAGEMENT

Build a complete catalog interface.

## Product types

Support:

1. Simple products.
2. Variable products with multiple variants.

Examples of attributes:

* Color.
* Size.
* Material.
* Style.
* Other configurable attributes.

## Variant requirements

* Each variant has a stable ID and SKU.
* Each variant has a unique combination of attribute values within its product.
* Variants may have their own images.
* Variants may inherit product-level metadata.
* Variant-level overrides must be supported.
* Bulk editing must be available.
* Bulk edits must preserve explicitly overridden values.
* Product images and variant images must use the media manager.
* Variants must connect directly to inventory and order items.

## Product management interface

Provide:

* Product list.
* Search.
* Filtering.
* Sorting.
* Pagination.
* Create and edit forms.
* Variant generation.
* Variant bulk editing.
* Image assignment.
* Pricing configuration.
* Inventory visibility.
* Publication status.
* SEO fields.
* Archive/deactivate behavior.

Do not allow deleting products in ways that break order history.

---

# 9. PRICING AND COST MANAGEMENT

Support configurable prices for:

* Storefront customers.
* Specific storefronts.
* Resellers.
* Price lists.
* Other explicitly configured sales channels.

Define a deterministic pricing resolution order.

Show authorized staff:

* Selling price.
* Purchase cost.
* Packaging cost.
* Other configured product costs.
* Gross margin and profitability indicators.

Restrict sensitive cost visibility through permissions.

## Product costs

Track purchase cost and applicable packaging or product-related costs.

Use weighted average cost for inventory valuation.

Define the treatment of additional purchase expenses and rounding.

Do not change historical order costs when current product costs change.

---

# 10. PURCHASING AND RECEIVING

Implement the purchasing workflow:

1. Create a purchase order.
2. Add multiple product variants.
3. Specify quantities and unit costs.
4. Save or submit the purchase.
5. Receive all or part of the purchase.
6. Record actual received quantities.
7. Update inventory through auditable movements.
8. Update applicable weighted average costs.
9. Display purchase and receiving history.

Support partial receiving.

Prevent receiving the same quantity twice.

Do not implement supplier returns, supplier refunds, or supplier credit notes in v1.

## Manual inventory adjustment

Authorized staff may adjust inventory without creating a purchase order.

Require:

* Product variant.
* Quantity.
* Adjustment direction.
* Reason.
* User.
* Timestamp.
* Relevant note or reference.

Adjustments must never silently erase inventory history.

---

# 11. INVENTORY, RESERVATIONS, AND PREORDERS

This is a critical business module. Implement it carefully.

## Inventory states

Track sellable stock, reserved stock, damaged stock, inspection stock, and preorder commitments distinctly.

Never count damaged or inspection stock as immediately sellable.

Prevent negative physical inventory.

## Order reservation

When an order is created:

1. Validate product and variant status.
2. Validate current server-side prices.
3. Calculate available stock.
4. Reserve available quantities.
5. Create preorder commitments for any permitted uncovered quantity.
6. Record the stock allocation.
7. Commit the operation atomically.

An order must not reserve more physical stock than is available.

## Preorders

Preorders may be enabled or disabled according to product or variant configuration.

When preorder is enabled, allow unlimited preorder quantities, even when physical stock is insufficient.

Track the uncovered preorder quantity explicitly.

When new sellable stock is received:

1. Identify eligible preorder commitments.
2. Allocate new stock to the oldest eligible preorder first.
3. Continue in FIFO order.
4. Update reservation and preorder allocation records transactionally.
5. Avoid allocating the same received stock more than once.

Define how canceled, partially fulfilled, and already allocated preorders are handled.

## Cancellation

Before shipment:

* Customer or authorized staff may cancel an eligible order.
* Release physical stock reservations.
* Release preorder commitments.
* Record the cancellation.
* Reverse or initiate any required payment/refund operation without deleting history.

## Dispatch

When an order is dispatched:

* Validate the reservation.
* Consume the reserved quantity exactly once.
* Update physical stock.
* Create inventory movements.
* Update fulfillment state.
* Record shipment details.

A repeated dispatch request must not consume stock again.

---

# 12. CUSTOMERS AND CUSTOMER ACCOUNTS

Implement customer management with:

* Name.
* Normalized phone number.
* Optional email.
* District.
* Full address.
* Account status.
* Address book.
* Order history.
* Relevant customer notes and audit history.

The same normalized phone number must identify the same customer across storefronts.

## Checkout fields

Allow authorized administrators to configure which customer fields are required at checkout.

Support name, phone, district, and full address, with email optional.

Do not expose one customer's private information to another customer.

## Customer account

Customers should be able to:

* Claim or verify an account securely.
* Set a password.
* Log in.
* View order history.
* View order status.
* View shipment and tracking information.
* View relevant payment information.
* Cancel eligible orders.
* Submit eligible exchange requests.
* Manage their own permitted account details.

---

# 13. ORDER MANAGEMENT

Support orders from:

* Public storefronts.
* Admin or authorized staff.
* Resellers.
* In-store sales.

## Order contents

An order can contain multiple product variants.

Preserve historical snapshots for:

* Product name.
* SKU.
* Variant attributes.
* Quantity.
* Unit price.
* Discount.
* Applicable costs.
* Delivery fee.
* Additional charges.
* Final totals.

All prices and totals must be recalculated and validated on the server.

Never trust client-submitted totals.

## Order adjustments

Support:

* Discounts.
* District-based delivery charges.
* Additional charges with a required note.
* Configurable pricing behavior.

Record who created or modified an adjustment.

## In-store orders

An in-store order must:

* Be created by authorized staff.
* Immediately be marked delivered according to the documented workflow.
* Not require courier shipment.
* Allow customer information to be optional.
* Update inventory consistently.
* Record payment status accurately.

Do not send an in-store order through courier workflows unless explicitly requested.

## Order status

Define a clear state machine.

Separate, where appropriate:

* Order lifecycle.
* Payment lifecycle.
* Fulfillment lifecycle.
* Courier lifecycle.
* Exchange lifecycle.

Document permitted transitions and who may perform them.

Do not let arbitrary status changes bypass stock or payment logic.

---

# 14. CHECKOUT AND PAYMENT PROCESSING

Build a secure checkout experience.

## Checkout

* Validate the cart.
* Load current products and prices.
* Validate product availability and preorder eligibility.
* Calculate discounts and delivery fees.
* Validate customer information.
* Create the order and inventory reservations transactionally.
* Create the payment attempt where applicable.
* Return a clear order confirmation.

Handle failed checkout without leaving orphaned reservations or inconsistent orders.

## Payment methods

Support:

* Cash on delivery.
* bKash.
* SSLCommerz.

Use provider adapters so payment methods remain isolated from order business logic.

## Payment verification

Never trust browser redirects as proof of successful payment.

Verify transactions using trusted server-side verification or authenticated provider callbacks.

Persist provider references and payment attempts.

Prevent duplicate payment application.

Support partial payments and refunds.

Maintain an auditable payment history.

---

# 15. COURIER INTEGRATIONS

Implement separate, maintainable adapters for:

* Pathao.
* Steadfast.
* CarryBee.

## Adapter architecture

Each provider adapter must handle:

* Authentication.
* Request payload construction.
* Shipment creation.
* Provider response parsing.
* Tracking lookup where supported.
* Status mapping.
* Webhook verification where supported.
* COD information.
* Error handling.
* Retryable versus permanent failures.

Keep provider-specific outgoing data in separate files, for example:

* `pathao-outgoing-data.ts`
* `steadfast-outgoing-data.ts`
* `carrybee-outgoing-data.ts`

Do not spread provider-specific fields throughout the application.

## Shipment tracking

Track:

* Internal shipment ID.
* Courier provider.
* Courier order ID.
* Tracking ID.
* Shipment status.
* Courier charge.
* COD charge.
* Expected COD collection.
* Actual COD collection.
* Relevant provider events.
* Settlement status.

## Webhooks

Implement authenticated and idempotent webhook handling.

Webhook processing must:

1. Verify authenticity where the provider supports it.
2. Persist the event.
3. Prevent duplicate processing.
4. Map provider statuses safely.
5. Apply allowed state transitions.
6. Update the order and shipment consistently.
7. Record failures for investigation or retry.

Do not invent provider endpoints, credentials, request fields, or webhook capabilities.

Use official provider documentation and clearly document any integration that requires credentials or external configuration.

---

# 16. EXCHANGES

Implement exchanges against delivered orders.

## Default policy

The default exchange eligibility window is 7 calendar days after delivery.

Make the exchange window configurable.

## Exchange functionality

Support:

* Selecting original order items.
* Partial item quantities.
* Multiple original items.
* Multiple replacement items.
* Replacement price differences.
* Delivery-fee rules.
* Exchange reasons.
* Exchange status tracking.
* Inspection of returned items.
* Exchange audit history.

## Financial differences

If the replacement costs more, calculate the amount to collect.

If the replacement costs less, calculate the amount to refund.

Use explicit payment/refund records for the difference.

Do not silently alter the original completed order's financial history.

## Returned goods

Returned products must enter inspection.

Do not automatically make returned products sellable.

Authorized staff must determine their appropriate stock condition.

Do not implement standalone return-only processing in v1.

---

# 17. RESELLER MANAGEMENT

Build a dedicated reseller portal and admin management interface.

## Reseller pricing

* Configure prices per product variant.
* Support changes over time without rewriting completed orders.
* Show authorized resellers their applicable prices.
* Restrict access to confidential business costs.

## Customer collection amount

A reseller may choose the amount collected from their customer.

Validate the amount according to business rules.

Record:

* The selected amount.
* The user who selected it.
* The applicable order.
* Relevant changes.
* Any financial effect.

Do not treat customer collection as automatically equivalent to reseller earnings.

## Packaging costs

Allow configuration of whether packaging cost is included in reseller pricing or calculated separately.

Make the calculation explicit and auditable.

## Reseller earnings

Reseller earnings must be calculated according to documented rules.

**Earnings must not become payable merely because the courier marks an order delivered.**

Earnings become eligible for payout only after the actual courier COD settlement has been received and reconciled.

Support:

* Partial courier settlements.
* Partial reseller earnings eligibility.
* Multiple settlement batches.
* Partial reseller payouts.
* Selected orders or ledger entries.
* Payout history.
* Remaining payable balances.
* Reconciliation.

Prevent duplicate payouts.

Never pay out more than the eligible reconciled balance.

---

# 18. FINANCE AND REPORTING

Build reporting around real database records and clearly defined financial calculations.

Provide reports for:

* Sales.
* Orders.
* Product performance.
* Inventory.
* Purchase costs.
* Inventory valuation.
* Gross margin.
* Packaging expenses.
* Courier expenses.
* COD charges.
* Payments received.
* Outstanding COD settlements.
* Refunds.
* Exchange adjustments.
* Reseller earnings.
* Reseller payouts.
* Remaining reseller liabilities.

Distinguish:

* Order revenue.
* Cash collected.
* Payment-provider settlement.
* Courier COD settlement.
* Inventory cost.
* Operating expenses.
* Refunds.
* Reseller payable.
* Reseller payouts.

Do not present an estimate as a confirmed financial amount.

Reports must respect user permissions.

Support appropriate date filters, pagination, export, and clear empty states.

Document every financial formula.

---

# 19. STOREFRONT EXPERIENCE

Build a fast, responsive, SEO-friendly public storefront.

## Required pages

* Homepage.
* Product listing.
* Category listing.
* Product detail.
* Search results.
* Cart.
* Checkout.
* Order confirmation.
* Customer account.
* Order history.
* Order detail and tracking.
* Custom content pages.
* Review submission where eligible.

## Product pages

Support:

* Product images.
* Variant selection.
* Variant-specific images.
* Price.
* Stock availability.
* Preorder information.
* Product descriptions.
* Reviews.
* SEO metadata.
* Add-to-cart behavior.

Do not show unavailable variants as purchasable unless preorder is enabled.

## Multiple storefronts

Multiple domains must be able to share the same catalog, customer records, and inventory.

Resolve the storefront using a validated domain/configuration mapping.

Avoid duplicating shared business records unnecessarily.

## Performance

Use appropriate:

* Server rendering.
* Caching.
* Revalidation.
* Optimized images.
* Pagination.
* Database indexes.
* Query optimization.
* Loading states.
* Error boundaries.

Do not cache sensitive customer or order data publicly.

---

# 20. DRAG-AND-DROP PAGE BUILDER

Build an Elementor-like page builder for authorized administrators.

The builder must support:

* Drag and drop.
* Reordering sections.
* Adding and removing components.
* Editing text and images.
* Editing backgrounds and spacing.
* Responsive settings.
* Desktop, tablet, and mobile previews.
* Draft previews.
* Save and publish.
* Page revisions.
* Reusable sections or templates.
* SEO configuration.

Use a structured, versioned page document.

Do not execute arbitrary user-provided JavaScript.

Validate page-builder data before saving and rendering.

Implement a limited, secure set of supported components instead of allowing unrestricted code execution.

Ensure published pages render correctly on the public storefront.

---

# 21. MEDIA MANAGER

Build a reusable media manager with S3-compatible storage.

Support:

* Upload.
* Drag and drop.
* Multiple file uploads.
* Folder creation.
* Folder navigation.
* Rename.
* Move.
* Copy.
* Delete.
* Search.
* Filtering.
* Preview.
* File metadata.
* Alt text.
* Reuse of existing assets.

All uploaded files must be referenced through media records rather than hardcoded file paths throughout the application.

## Security

* Validate MIME type and file extension.
* Enforce size limits.
* Restrict uploads to authorized users.
* Prevent unauthorized media access.
* Use safe object keys.
* Do not expose private storage credentials.
* Use signed URLs when appropriate.
* Prevent deleting assets still in use without an appropriate warning or policy.

Support product images, variant images, page-builder images, review images, and other permitted media.

---

# 22. PRODUCT REVIEWS

Implement verified-purchase product reviews.

Requirements:

* A customer may submit a review only for a product they purchased.
* Enforce the rule of one review per customer per product, according to the documented purchase eligibility policy.
* Support review moderation.
* Support review status.
* Allow a maximum of 3 images per review.
* Default combined image limit: 50 MB.
* Make applicable limits configurable.
* Store review images using the media system.
* Prevent unauthorized modification or deletion.
* Avoid exposing customer private information.

Document whether a review is eligible after cancellation, exchange, or partial fulfillment.

---

# 23. API KEYS AND EXTERNAL API

Build secure API-key management for external integrations.

Support:

* Creating API keys.
* Naming keys.
* Assigning scopes.
* Expiration.
* Revocation.
* Usage tracking.
* Rate limiting.
* Key rotation.

Show the full key only once when created.

Store a cryptographic hash of the key, not the plaintext secret.

Never log API secrets.

Implement scoped access to permitted product and order data.

Use versioned endpoints under `/api/v1`.

Validate all incoming data.

Use consistent response and error formats.

Document authentication, permissions, pagination, filtering, rate limits, and examples.

Do not expose internal fields by default.

---

# 24. MARKETING PIXELS AND SERVER-SIDE EVENTS

Implement an extensible marketing integration architecture.

Initial focus:

* Meta Pixel.
* Meta server-side conversion events.
* Additional providers through adapters.

Support events such as:

* Product view.
* Add to cart.
* Checkout initiation.
* Purchase.
* Other explicitly supported storefront events.

## Consent and privacy

* Respect applicable user consent.
* Avoid firing consent-dependent tracking before permission is granted.
* Do not expose private payment information.
* Minimize personal data sent to providers.
* Use appropriate server-side event identifiers.
* Prevent duplicate event delivery.
* Document configuration and data handling.

Do not claim that an event was delivered unless delivery was confirmed.

---

# 25. PLUGIN ARCHITECTURE

Prepare a safe extension architecture for future plugins.

Version 1 supports trusted, registered plugins only.

Do not implement arbitrary third-party code execution.

Support:

* Plugin registry.
* Plugin metadata.
* Version compatibility.
* Enable/disable configuration.
* Explicit permissions.
* Supported extension points.
* Configuration validation.
* Audit logging.

Plugins must not bypass authorization, inventory integrity, or financial controls.

Document how future plugins can extend the platform safely.

Do not build a public plugin marketplace in v1 unless explicitly approved.

---

# 26. IN-APP NOTIFICATIONS

Implement in-app notifications for relevant events.

Examples:

* New order.
* Order status change.
* Payment status update.
* Exchange request.
* Exchange status update.
* Stock-related alerts.
* Courier status update.
* Settlement update.
* Reseller payout update.
* Review moderation update.

Each notification must reference the relevant business entity and navigate to its appropriate detail page.

Support:

* Read/unread status.
* Mark as read.
* Mark all as read.
* Relevant notification preferences.
* Permission-aware content.

Do not implement push notifications in v1.

Do not send users notifications they are not authorized to view.

---

# 27. ADMIN UI AND UX

Build a modern, colorful, intuitive, responsive interface.

The design must feel like a coherent business application rather than disconnected admin pages.

## Global layout

Provide:

* Responsive sidebar.
* Top navigation.
* Breadcrumbs.
* Search where appropriate.
* Notification center.
* User menu.
* Permission-aware navigation.
* Responsive mobile navigation.

## Data-heavy pages

Use reusable components for:

* Data tables.
* Search.
* Filters.
* Pagination.
* Sorting.
* Bulk actions.
* Row actions.
* Detail panels.
* Confirmation dialogs.
* Forms.
* Validation errors.
* Loading states.
* Empty states.
* Error states.

## Forms

Use consistent:

* Labels.
* Help text.
* Validation.
* Required-field indicators.
* Save and cancel actions.
* Unsaved-change warnings where appropriate.
* Clear success and error feedback.

## Dashboard

Build dashboards using real API-backed data.

Show useful metrics based on permissions, such as:

* Orders.
* Sales.
* Inventory.
* Pending shipments.
* Exchanges.
* Payments.
* Settlements.
* Reseller liabilities.

Do not use hardcoded statistics.

## Important UX rule

Every visible control must have a real, functional action.

Do not display buttons, filters, tabs, charts, or forms that are decorative placeholders.

If a feature is not implemented, do not present it as completed.

---

# 28. API AND SERVICE DESIGN

Separate the system into clear layers.

## Suggested request flow

```text
UI / External Client
        |
        v
API Route / Server Action
        |
        v
Authentication
        |
        v
Authorization / Policy
        |
        v
Validation
        |
        v
Domain Service
        |
        v
Database Transaction
        |
        v
Outbox / Background Job (when required)
        |
        v
Response
```

Use domain services for important workflows.

Examples:

* `createOrder`
* `reserveInventory`
* `allocatePreorders`
* `receivePurchase`
* `dispatchOrder`
* `cancelOrder`
* `processPaymentCallback`
* `createCourierShipment`
* `processCourierWebhook`
* `createExchange`
* `reconcileCourierSettlement`
* `calculateResellerEarnings`
* `createResellerPayout`

These are conceptual names. Adapt them to the project's conventions.

Do not create duplicated implementations of the same business rule in multiple API routes.

## API standards

Use:

* Consistent response structures.
* Zod validation.
* Appropriate HTTP status codes.
* Permission checks.
* Pagination.
* Filtering.
* Sorting.
* Stable error codes.
* Request IDs or correlation IDs where appropriate.
* Idempotency keys for critical operations.

Avoid returning sensitive database fields by default.

---

# 29. BACKGROUND JOBS AND RELIABLE INTEGRATIONS

Use a practical background-processing approach appropriate for the existing VPS and budget.

Do not introduce an expensive infrastructure dependency without justification.

Use an outbox or durable job pattern for important external side effects where appropriate.

Examples:

* Courier shipment creation.
* Payment verification retries.
* Webhook processing.
* Notification generation.
* Marketing event delivery.
* Settlement reconciliation.
* Scheduled cleanup.

Requirements:

* Retry policy.
* Maximum attempts.
* Idempotency.
* Failure tracking.
* Safe concurrency.
* Observability.
* Manual retry or recovery where appropriate.

Do not mark external operations successful before the provider confirms them.

If the system uses a database-backed worker, document how it runs on the VPS and how deployment manages it.

---

# 30. VALIDATION, ERRORS, AND AUDITABILITY

Implement consistent validation and error handling.

## Validation

Validate data at the API/service boundary.

Enforce business invariants in domain services and, where practical, the database.

Never trust browser input for:

* Prices.
* Discounts.
* Inventory availability.
* Payment status.
* User permissions.
* Courier status.
* Reseller earnings.
* Settlement amounts.

## Error handling

Provide:

* User-friendly error messages.
* Stable internal error codes.
* Appropriate HTTP status codes.
* Safe server logs.
* Correlation IDs where useful.

Do not expose stack traces, secrets, SQL details, or provider credentials to users.

## Audit logs

Record important changes, including:

* User.
* Action.
* Entity.
* Timestamp.
* Relevant before/after values.
* Reason where required.
* Related request or transaction.

Audit financial and inventory changes especially carefully.

---

# 31. REQUIRED WORKFLOWS

Implement and test the following end-to-end workflows.

## Workflow A: Catalog creation & product authoring

1. Admin creates a product (specifying Title/Name, Product SKU/Code, Barcode, and Descriptions).
2. Admin sets Pricing Defaults (Current Price, Discount Type & Value, Calculated Sell Price, Unit Label).
3. Admin configures Product Organization (Brand, Categories, Tax Rate Presets, Packaging Cost Templates, Shipping/Weight).
4. Admin configures Attributes & generates Variant combinations (optionally assigning attribute-level pricing or default images).
5. Admin reviews Variant Overrides and applies Bulk Actions (editing prices, costs, or clearing overrides to restore inheritance).
6. Admin assigns Product Images and Gallery Media (with automatic fallback to attribute or product primary media).
7. Admin configures Settings, SEO, and Preorder rules, then saves as Draft or Publishes.
8. Stock is never created during product creation; stock is received solely through purchasing or authorized adjustments.
9. Product and variants appear on the appropriate storefront with server-side price resolution and inventory checks.

## Workflow B: Purchase and stock receiving

1. Staff creates a purchase.
2. Staff adds multiple variants.
3. Staff specifies quantities and unit costs.
4. Staff receives some or all quantities.
5. System creates inventory movements.
6. Inventory balances update.
7. Weighted average cost updates.
8. Purchase and receipt history remains auditable.

## Workflow C: Normal customer order

1. Customer browses a storefront.
2. Customer selects variants.
3. Customer adds products to cart.
4. Customer enters checkout information.
5. Server validates prices and availability.
6. Server creates the order.
7. System reserves stock.
8. Payment attempt is created where appropriate.
9. Staff processes fulfillment.
10. Courier shipment is created when applicable.
11. Shipment status updates.
12. Dispatch consumes reserved stock exactly once.
13. Delivery and payment are recorded.
14. Customer can see the order history and tracking.

## Workflow D: Preorder

1. Preorder is enabled for a product or variant.
2. Customer orders beyond current available stock.
3. System reserves available physical stock.
4. System records uncovered preorder quantity.
5. New stock is received.
6. System allocates new stock to the oldest eligible preorder.
7. Reservation records update.
8. Order becomes fulfillable when appropriate.
9. Stock is consumed once at dispatch.

## Workflow E: Cancellation

1. Customer or authorized staff requests cancellation.
2. System validates the order's current state.
3. Reservation is released.
4. Preorder commitments are released.
5. Payment/refund requirements are handled.
6. Status history is recorded.
7. Repeated cancellation requests do not release stock twice.

## Workflow F: In-store sale

1. Authorized staff creates an order.
2. Customer details may be omitted.
3. Products and quantities are selected.
4. Server calculates totals.
5. Inventory is updated through the proper workflow.
6. Order is immediately recorded as delivered.
7. No courier shipment is created.
8. Payment is recorded accurately.

## Workflow G: Exchange

1. Customer or staff selects an eligible delivered order.
2. System validates the exchange window.
3. User selects original item quantities.
4. User selects replacement variants and quantities.
5. System calculates price difference and delivery charges.
6. Exchange is recorded.
7. Returned items enter inspection.
8. Additional payment or refund is recorded.
9. Replacement fulfillment is tracked.
10. Original order history remains intact.

## Workflow H: Courier COD settlement

1. Courier delivers an eligible shipment.
2. Delivery status is recorded.
3. Courier settlement is received.
4. Settlement data is imported or recorded.
5. Entries are reconciled against shipments.
6. Actual COD collection is confirmed.
7. Courier fees and COD charges are recorded.
8. Reseller earnings become eligible according to the documented formula.
9. Unmatched entries remain visible for investigation.

## Workflow I: Reseller payout

1. Eligible reconciled reseller earnings are identified.
2. Authorized staff selects entries or orders.
3. System calculates the eligible payout.
4. System validates the remaining payable balance.
5. Payout is recorded.
6. Ledger entries are allocated.
7. Remaining balances update.
8. Duplicate payout is prevented.
9. Audit history is retained.

## Workflow J: Payment callback

1. Provider sends a callback.
2. System verifies authenticity or performs trusted provider verification.
3. Event is persisted.
4. Duplicate event is detected.
5. Payment status is updated transactionally.
6. Relevant order state is updated only through allowed transitions.
7. Failed verification is recorded safely.

## Workflow K: Customer account claim

1. Customer initiates verification.
2. System verifies control of the normalized phone number or supported identity.
3. Verification expires after a configured interval.
4. Attempt limits are enforced.
5. Customer securely claims the account.
6. Customer sets a password if applicable.
7. Customer can access only their own records.

## Workflow L: Storefront page publishing

1. Admin opens the page builder.
2. Admin edits a draft.
3. Admin adds and reorders components.
4. Admin previews responsive layouts.
5. System validates the page document.
6. Admin publishes a new version.
7. Public storefront renders the published version.
8. Previous versions remain available according to the revision policy.

---

# 32. TESTING REQUIREMENTS

Testing is mandatory.

Do not consider a module complete because its UI renders.

## Unit tests

Test:

* Money calculations.
* Pricing precedence.
* Inventory availability.
* Reservation allocation.
* FIFO preorder allocation.
* Weighted average cost.
* Order totals.
* Delivery fee calculation.
* Exchange differences.
* Reseller earnings.
* Settlement reconciliation.
* Permission policies.
* Status transitions.

## Integration tests

Test:

* Database transactions.
* Inventory reservation concurrency.
* Purchase receiving.
* Order creation.
* Order cancellation.
* Dispatch idempotency.
* Payment callback idempotency.
* Courier webhook idempotency.
* Exchange workflows.
* COD reconciliation.
* Reseller payout limits.

## End-to-end tests

Cover the most important customer and staff journeys.

Use the project's existing test tools or select appropriate lightweight tools.

## Essential edge cases

Test:

* Two orders competing for the same stock.
* Duplicate payment callbacks.
* Duplicate courier webhooks.
* Partial purchase receiving.
* Partial stock allocation to preorders.
* Cancellation after partial allocation.
* Invalid status transitions.
* Partial exchanges.
* Partial courier settlement.
* Partial reseller payout.
* Refund failure.
* Expired customer verification.
* Unauthorized access to another customer's order.
* Deleted or archived products referenced by old orders.

Do not claim tests passed unless they were actually run.

---

# 33. DOCUMENTATION REQUIREMENTS

Maintain these documents as implementation progresses.

## `docs/PROJECT_AUDIT.md`

* Existing repository structure.
* Existing architecture.
* Existing features.
* Reusable code.
* Technical debt.
* Identified bugs.
* Compatibility risks.

## `docs/ARCHITECTURE.md`

* System overview.
* Module boundaries.
* Request flow.
* Service architecture.
* Integration architecture.
* Background jobs.
* Security boundaries.
* Deployment architecture.

## `docs/DATABASE_DESIGN.md`

* Complete model inventory.
* Entity relationships.
* Important constraints.
* Indexes.
* Financial data strategy.
* Inventory invariants.
* Historical snapshots.
* Transaction boundaries.

## `docs/BUSINESS_RULES.md`

* Inventory formulas.
* Reservation behavior.
* Preorder FIFO.
* Pricing precedence.
* Weighted average cost.
* Order state machine.
* Payment state machine.
* Courier state mapping.
* Exchange eligibility.
* Reseller earnings.
* COD reconciliation.
* Payout eligibility.
* Financial formulas.

## `docs/API.md`

* Endpoints.
* Authentication.
* Permissions.
* Request/response examples.
* Pagination.
* Error codes.
* Idempotency.
* Rate limits.
* Webhooks.

## `docs/SECURITY.md`

* Authentication.
* Authorization.
* Session handling.
* Customer identity.
* API keys.
* Upload security.
* Webhook security.
* Secrets.
* Privacy.
* Audit logging.

## `docs/DEPLOYMENT.md`

* Environment variables.
* PostgreSQL setup.
* Prisma migrations.
* Build process.
* VPS deployment.
* Worker process.
* Reverse proxy.
* HTTPS.
* Object storage.
* Backups.
* Restore procedure.
* Monitoring.
* Rollback procedure.

## `docs/TESTING.md`

* Test commands.
* Test structure.
* Coverage of critical workflows.
* Known limitations.
* Manual verification steps.

## `docs/IMPLEMENTATION_PLAN.md`

* Five stages.
* Dependencies.
* Completion criteria.
* Outstanding work.
* Known risks.

---

# 34. IMPLEMENTATION MUST BE DIVIDED INTO FIVE STAGES

Implement the complete system in five ordered stages.

Do not attempt to implement all modules simultaneously.

Do not skip foundational work merely to create visible UI faster.

Each stage must leave the project in a coherent, testable state.

## STAGE 1 — FOUNDATION, AUTHENTICATION, DATABASE, AND ADMIN SHELL

Implement:

* Repository audit.
* Architecture documentation.
* Database design.
* Complete initial Prisma schema.
* Migrations.
* Database constraints and indexes.
* Authentication.
* Customer identity foundation.
* Roles and permissions.
* Authorization middleware/policies.
* Audit logging foundation.
* Shared validation and error handling.
* Shared UI components.
* Admin layout and navigation.
* Environment configuration.
* Logging.
* Test infrastructure.
* Initial seed/setup process.

### Stage 1 acceptance criteria

* Application builds.
* Database migrations run successfully.
* Authentication works.
* Permission checks are enforced server-side.
* Protected routes are protected.
* Database constraints are documented.
* No secrets are exposed.
* Core tests pass.
* Existing working functionality remains intact.

Do not begin complex inventory and payment workflows until the foundation is stable.

## STAGE 2 — CATALOG, PRICING, PURCHASING, AND INVENTORY

Implement:

* Product catalog.
* Categories.
* Attributes.
* Simple products.
* Variable products.
* Variant generation.
* SKU uniqueness.
* Variant combination validation.
* Variant images.
* Pricing.
* Product costs.
* Suppliers.
* Purchase orders.
* Partial receiving.
* Inventory ledger.
* Stock adjustments.
* Stock reservations.
* Preorder commitments.
* FIFO preorder allocation.
* Inventory dashboard and reports.
* Relevant audit history.

### Stage 2 acceptance criteria

* Product and variant management works.
* Pricing is calculated server-side.
* Receiving updates stock transactionally.
* Weighted average cost is correct.
* Concurrent reservations cannot oversell physical stock.
* Preorders allocate FIFO.
* Inventory movements are auditable.
* Negative physical stock is prevented.
* Critical inventory tests pass.

## STAGE 3 — CUSTOMERS, STOREFRONT CHECKOUT, ORDERS, PAYMENTS, COURIERS, AND EXCHANGES

Implement:

* Customer accounts.
* Secure account claim.
* Customer addresses.
* Public storefront catalog.
* Cart.
* Checkout.
* Order management.
* In-store orders.
* Cancellation.
* Order state machine.
* Payment attempts.
* COD.
* bKash integration.
* SSLCommerz integration.
* Pathao integration.
* Steadfast integration.
* CarryBee integration.
* Courier webhooks.
* Shipment tracking.
* COD collection records.
* Exchanges.
* Inspection workflow.
* Refund records.
* Customer order history.

### Stage 3 acceptance criteria

* Customers can complete a valid order.
* Server validates prices and availability.
* Stock is reserved and consumed correctly.
* Cancellation releases stock only once.
* In-store orders do not create courier shipments.
* Payment callbacks are verified and idempotent.
* Courier requests use provider adapters.
* Webhooks are safely processed.
* Exchanges preserve original order history.
* Critical end-to-end tests pass.

## STAGE 4 — RESELLERS, SETTLEMENTS, FINANCE, REPORTING, AND NOTIFICATIONS

Implement:

* Reseller accounts.
* Reseller portal.
* Reseller pricing.
* Customer collection amounts.
* Packaging configuration.
* Earnings calculation.
* Courier settlement import/recording.
* Settlement reconciliation.
* Earnings eligibility.
* Partial reseller payouts.
* Financial ledgers.
* Finance reports.
* Inventory valuation reports.
* Sales reports.
* Reseller reports.
* In-app notifications.
* Notification references and permissions.
* Audit history for financial operations.

### Stage 4 acceptance criteria

* Reseller earnings are not payable before reconciled courier COD settlement.
* Partial settlements are supported.
* Partial payouts are supported.
* Duplicate payouts are prevented.
* Financial reports distinguish revenue, cash received, expenses, and liabilities.
* Financial formulas are documented and tested.
* Notifications link to relevant content.
* Critical reconciliation tests pass.

## STAGE 5 — PAGE BUILDER, MEDIA, REVIEWS, API KEYS, MARKETING, PLUGINS, AND PRODUCTION HARDENING

Implement:

* S3-compatible media manager.
* Upload and drag-and-drop.
* Folder management.
* Media references.
* Drag-and-drop page builder.
* Responsive preview.
* Page revisions.
* Publishing.
* Storefront themes and configuration.
* SEO.
* Product reviews.
* Review moderation.
* Review image limits.
* Scoped API keys.
* Product/order API.
* Marketing pixel configuration.
* Consent-aware server-side events.
* Trusted plugin registry.
* Background jobs and outbox processing.
* Performance improvements.
* Security review.
* Backup and restore documentation.
* Production deployment documentation.
* Final end-to-end testing.

### Stage 5 acceptance criteria

* Media uploads use S3-compatible storage.
* Page builder saves and renders validated page documents.
* Public storefront pages are responsive and SEO-aware.
* Reviews enforce eligibility and image limits.
* API keys are hashed, scoped, revocable, and rate-limited.
* Marketing events respect consent and avoid duplicate delivery.
* Plugins cannot execute arbitrary untrusted code.
* Background jobs are retryable and idempotent.
* Deployment and recovery instructions are documented.
* Critical tests pass.
* No major feature is presented as complete when it is only a mock.

---

# 35. AGENT EXECUTION RULES

Follow these rules throughout implementation.

## Work incrementally

At the start of each stage:

1. Read the existing implementation and relevant documentation.
2. Review the current Git status.
3. Identify dependencies and migration risks.
4. Write a concrete task checklist.
5. Identify files that will be created or changed.
6. Identify important tests.

Then implement in small, coherent increments.

## Before database changes

* Inspect the current Prisma schema.
* Preserve existing data.
* Create migrations rather than destructive resets.
* Review migration SQL where appropriate.
* Avoid dropping columns or tables without an explicit migration plan.
* Do not use destructive database reset commands against a database containing user data.
* Document any unavoidable data migration.

## Before external integrations

* Inspect official provider documentation.
* Identify required credentials.
* Define the adapter contract.
* Separate provider payload mapping from business logic.
* Handle retries and duplicate callbacks.
* Do not invent endpoints or claim an integration is verified without testing it.

## Before declaring a feature complete

Verify:

* UI exists.
* API or server-side action exists.
* Authorization exists.
* Validation exists.
* Database persistence exists.
* Loading and error states exist.
* Relevant audit history exists.
* Tests exist and have been run.
* Documentation is updated.

## Do not

* Replace the entire repository without justification.
* Create a mock backend.
* Hardcode business data in place of real queries.
* Hardcode secrets.
* Trust browser-submitted prices.
* Bypass domain services for critical operations.
* Ignore concurrency.
* Allow duplicate stock consumption.
* Allow duplicate payment application.
* Allow duplicate reseller payouts.
* Delete financial history.
* Claim untested features work.
* Mark unfinished integrations as complete.
* Add unnecessary dependencies or infrastructure.
* Implement future multi-business switching in v1.
* Implement supplier returns in v1.
* Implement inter-location transfers in v1.
* Implement push notifications in v1.
* Implement arbitrary third-party plugin execution in v1.

---

# 36. REQUIRED RESPONSE AFTER EACH STAGE

After completing each stage, provide a concise but informative report.

Include:

## 1. Summary

What was implemented and how it fits into the architecture.

## 2. Files changed

Important files created, modified, or removed.

## 3. Database changes

Models, migrations, indexes, constraints, and any data migration.

## 4. Business logic

Important workflows and invariants implemented.

## 5. Tests

Tests added, commands executed, and actual results.

Do not claim tests passed if they were not run.

## 6. Remaining issues

Known bugs, incomplete requirements, provider credentials needed, and technical debt.

## 7. Next stage

The exact remaining tasks and dependencies.

Do not begin the next stage automatically if doing so would make the current stage difficult to review or verify.

---

# 37. FINAL DELIVERABLES

At the end of all five stages, deliver:

1. A working Next.js application.
2. A complete Prisma schema.
3. Versioned database migrations.
4. Functional authentication and authorization.
5. A real catalog and inventory system.
6. A complete purchasing and receiving workflow.
7. A functioning storefront and checkout.
8. Order management.
9. Payment integration adapters.
10. Courier integration adapters.
11. Exchange management.
12. Reseller and settlement management.
13. Finance and reporting.
14. Media manager.
15. Page builder.
16. Product reviews.
17. Scoped external API.
18. Marketing integrations.
19. In-app notifications.
20. Automated tests.
21. Architecture and business-rule documentation.
22. Deployment and backup documentation.
23. A list of external credentials and configuration required for production.
24. A list of any incomplete or unverified integrations.

The final system must be maintainable, secure, auditable, and practical to operate on the existing VPS and budget.

---

# 38. START HERE

Begin with **Stage 1 only**.

First inspect the existing repository and produce the project audit.

Then propose the architecture and complete database design, including the detailed Prisma models, relations, enums, constraints, and indexes.

Review the schema for inventory integrity, payment idempotency, historical order snapshots, exchange relationships, courier settlement reconciliation, and reseller payout correctness.

After that, implement Stage 1 incrementally.

Do not skip the audit.

Do not assume the architecture is correct merely because it appears in this prompt. Validate it against the actual repository and the business requirements.

When a requirement is ambiguous, document the ambiguity and choose a conservative, auditable default. Ask for clarification only when the decision materially changes the business behavior or could cause data loss, financial errors, or irreversible actions.

**Your goal is a coherent, fully integrated business platform—not merely a large number of pages or database models.**
