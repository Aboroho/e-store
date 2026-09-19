# Testing

Status: Stages 1–3. This document lists what is tested, how to run it, and which
guarantees are intentionally *not* covered yet. The suite is 101 tests across 12 files.

## 1. Running the suite

```bash
npm run db:start      # embedded PostgreSQL (dev + shadow databases)
npm run db:deploy     # apply pending migrations
npm run db:seed       # permissions, roles, owner, location, price list, reasons
npm run check         # schema assembly check + tsc --noEmit + eslint
npx vitest run        # unit + integration
npm run build         # production build (needs real secrets in .env)
```

Integration suites skip themselves (via `describe.skipIf`) when PostgreSQL is not
reachable, so unit tests still run on a machine without a database. They never modify
the seeded demo business: each suite creates its own business with a unique slug and
deletes it afterwards (`tests/integration/fixtures.ts`).

## 2. Unit tests (`tests/lib`, 47 tests)

| File | Covers |
| --- | --- |
| `money.test.ts` | paisa parsing/formatting (`৳1,250.50`), BDT conversions, weighted-average cost arithmetic with BigInt, proportional allocation remainders |
| `permissions.test.ts` | permission catalogue, role templates, owner wildcard, `can`/`assertPermission` |
| `auth-password.test.ts` | bcrypt cost-12 hashing, verification, timing-safe comparison, token generation |
| `utils-validation.test.ts` | slug/phone normalisation, list-query parsing (sort allowlist, page clamping), form value coercion |

> `phoneNormalized` is the local `01XXXXXXXXX` form (not `880…`); it is the identity key for a
> customer and the lookup key for guest-order claiming.

## 3. Integration tests — Stages 1–2 (`tests/integration`, 22 tests)

All of them use the real Prisma client, the real services and real transactions —
nothing is mocked.

### `auth.test.ts` (5)

Failed login does not reveal whether an account exists; failure counters, lockout
window and `SecurityEvent` rows; successful login resets counters and creates a session
row; password change verifies the old password and revokes sessions.

### `catalog.test.ts` (5)

- Product creation with two variants → generated unique slug, price-list items,
  balance rows, attribute values linked.
- Duplicate SKU detection inside one submission raises an `AppError`, not a database
  error.
- Category path materialisation (`parent.slug/child.slug`) and cycle rejection.
- Price resolution: base tier, bulk tier (`minQuantity: 10`) and the fact that a bulk
  tier does **not** overwrite the base price.
- Archive guard: archiving fails while stock exists and succeeds once the stock is gone
  (row is soft-deleted and moved to `ARCHIVED`).

### `inventory.test.ts` (7)

- Default location resolution.
- 12 concurrent receipts leave `onHand = 12` and 12 movements — proof that the
  `FOR UPDATE` lock prevents lost updates.
- 10 concurrent outbound movements against 5 units: exactly 5 succeed, 5 fail, and
  `onHand` never goes below zero.
- Idempotency key replay returns the original movement and books stock once.
- Weighted average cost across two receipts (10 @ 100.00, 10 @ 150.00 → 125.00 exactly)
  and the fact that dispatching does not change it.
- Damaged/inspection stock is excluded from availability; dispatching more than the
  sellable quantity is rejected.
- Adjustment with a reason code writes movement + adjustment + audit row; a
  note-required reason rejects an empty note.

### `purchasing.test.ts` (6)

- Draft → ordered transition, `incomingQuantity` reflected on balances, order totals.
- Partial receipt: landed cost = invoice + prorated order extra cost (`floor(30,000 ×
  4/15)`), receipt-level expense allocation, `PARTIALLY_RECEIVED` status, unaffected
  second line.
- Idempotent receipt replay books nothing twice.
- Over-receipt is rejected.
- Completing the order capitalises the order-level extra cost **exactly once** across
  receipts (`allocatedExpensePaisa` sums to 50,000 + 12,000 in the test scenario) and
  clears incoming quantities.
- Cancelling releases incoming stock and stores the reason.

### `preorders.test.ts` (4)

- A commitment moves `preorderCommitted` only; extending it for the same order line
  updates the counter too.
- FIFO allocation serves the oldest commitment first, then partially allocates the
  next; availability and statuses after each step.
- Allocating more than exists is rejected by the strict path (no reservation, no
  counter drift); the queue path serves what exists and reports `skipped`.
- Cancelling a commitment releases reserved and committed counters.

## 4. Stage 3 suites

| File | Tests | What it proves |
| --- | --- | --- |
| `tests/integration/orders.test.ts` | 11 | price/cost snapshots at creation, reservation counters, idempotent replay, oversell refused (also under 3 concurrent orders), dispatch consumes stock exactly once and queues one outbox event, cancellation releases exactly once, one customer per phone, a session only after a verified code, partial → full payment, webhook applied once, COD + refund flow |
| `tests/integration/fulfilment.test.ts` | 8 | outbox retry/backoff when provider credentials are missing, provider request bodies and status mapping for Pathao/Steadfast/CarryBee, shipment status history is written once and moves the order, statement import matches/mismatches and refuses duplicates, COD marked settled with the courier's fees, exchange credit/charge maths, inspection restock, damaged returns, refund when the replacement is cheaper, CSV parsing |
| `tests/integration/storefront.test.ts` | 10 | storefront resolution, price-list pricing beats the variant override, zone fee and COD fee, double-submit idempotency, unavailable quantity refused, unknown slug refused, guest-order claiming after verification, signed courier webhook applied once, unsigned webhook refused and stored as failed, unknown tracking code ignored |

No test in these suites performs a network call: the outbox path is exercised with a
provider that has no credentials (the realistic half-configured state), and provider
payload builders are pure functions.

## 5. Stage 4 suite

| File | Tests | What it proves |
| --- | --- | --- |
| `tests/integration/resellers.test.ts` | 9 | a new reseller gets its own price list and a bulk markup lands at the marked-up price; delivery alone leaves earnings `PENDING` and the reconciling statement is what makes them `ELIGIBLE`; a delivery with cash recorded but no statement stays unpaid; a partially matched statement unlocks only the rows that matched (and the short-paid row survives an ignore + close without unlocking); the payable pool equals the ledger sums, a partial payout allocates a strict subset, a reserved entry cannot be claimed twice, a payout cannot spend the balance twice, the database refuses a duplicate allocation, a paid payout cannot be paid again with a second reference; cancelling before the payout is paid voids the entry, drops the claim and cancels the payout; cancelling after payment posts an opposing `REVERSAL` and leaves the paid row untouched; collection changes and adjustments are new auditable rows; every report figure reconciles with the ledger, the order totals and the stock balances it is derived from |

The suite drives the real services end to end (`createResellerOrder` → `dispatchOrder` →
`markOrderDelivered` → `recordCodCollection` → `importCourierSettlement` → `createPayout`
→ `markPayoutPaid`), so a change that breaks any link in the chain fails here. No provider
HTTP call is made: `MANUAL` is the own-delivery provider.

## 6. Manual verification recorded per stage

Each stage ends with a smoke pass against the running dev server using a real session
cookie (minted with the application's own `createSession`), verifying that every new
route renders with data created through the service layer. Stage 2 smoke results:
12 read routes returned `200` and rendered the expected content (product detail with
variants, price-list editor, inventory list, movement history, adjustment history,
preorder queue, purchase order detail with receipts and freight lines, supplier list).

Stage 3 smoke results: a storefront order was placed through `placeStorefrontOrder`
(real catalogue, district 26 zone fee, COD surcharge), then 22 admin routes were fetched
with a real session cookie — `/admin`, `/admin/orders`, `/admin/orders/new`,
`/admin/orders/<id>`, `/admin/customers`, `/admin/customers/<id>`, `/admin/shipments`,
`/admin/couriers`, `/admin/settlements`, `/admin/exchanges`, `/admin/exchanges/new`,
`/admin/payments`, `/admin/inventory`, `/admin/inventory/adjustments`,
`/admin/inventory/preorders`, `/admin/purchasing`, `/admin/purchasing/new`,
`/admin/purchasing/suppliers`, `/admin/catalog/products`, `/admin/catalog/categories`,
`/admin/catalog/attributes`, `/admin/catalog/price-lists` — all returned `200` and
rendered real rows. `/checkout` rendered the live catalogue and `/account` rendered the
sign-in form without a session; `/admin/orders` without a cookie redirected to
`/login?next=%2Fadmin%2Forders`.

Stage 4 smoke results: a demo reseller, stock and reseller order were created through the
service layer, the COD cash was collected and the statement imported and reconciled, then
these routes were fetched with a real session cookie — `/admin/resellers`,
`/admin/resellers/<id>`, `/admin/resellers/<id>/pricing`, `/admin/resellers/<id>/ledger`,
`/admin/payouts`, `/admin/payouts/new`, `/admin/payouts/<id>`, `/admin/reports` and all
eleven `/admin/reports/<key>` screens — every one returned `200` and rendered the expected
balances (`awaiting settlement`, `payable now`, `claimed by a pending payout`). The export
endpoint returned a real PDF (`%PDF-` magic, `Content-Disposition: attachment`) and a real
XLSX (PK zip with a `Gross profit` sheet); an unauthenticated request was redirected to
`/admin/login`, an unknown report was `404` and an unsupported format was `422`.

## 7. Adding tests

1. Put pure logic in `tests/lib`, database behaviour in `tests/integration`.
2. Use `createTestBusiness()` from `tests/integration/fixtures.ts`; never touch the
   seeded demo business.
3. Assert on database state as well as return values — the ledger is the contract.
4. Prefer concurrent `Promise.all` assertions for anything that must survive races.
5. If a test exposes a real bug, fix the service and keep the test.

## 8. Not covered yet (deliberate)

- Browser/E2E automation (Playwright) — deferred to Stage 5 hardening.
- Payment/courier provider sandboxes — the adapters are covered by payload-builder and
  status-mapping tests; real provider calls are never made from tests.
- Load/soak testing, S3 uploads (storage driver is `disabled` here) and SMTP delivery —
  Stage 5.
- The FK/constraint drift checker runs as `npm run db:check-fk` and requires a migrated
  database; it is not part of `npm run check` because it needs PostgreSQL.
