# Testing

Status: Stages 1–5 complete. This document lists what is tested, how to run it, and which
guarantees are intentionally *not* covered yet. The suite is **137 tests across 16 files**
(45 unit + 92 integration), all passing against a freshly migrated PostgreSQL database.

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

## 2. Unit tests (`tests/lib`, 45 tests)

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

## 6. Stage 5 suites

| File | Tests | What it proves |
| --- | --- | --- |
| `tests/integration/content.test.ts` | 9 | a page is created as a draft with version 1 and never serves until published; `saveDraft` adds an immutable version and archives the previous draft; **saving a draft on a live page keeps the published version serving** (`status` stays `PUBLISHED`, `publishedVersionId` unchanged, `draftVersionId` moves to the newest draft); publishing promotes that draft and archives the old one; an unknown block type or invalid props are rejected by `parsePageDocument`; a page that references a media asset cannot have that asset deleted; restore copies an old version forward as a *new* draft ("Restored from v1"); publish/unpublish changes what `publishedPage` returns (drafts, wrong slugs and unpublished pages are 404s); media upload goes through `requestUpload` → signed `PUT` → `confirmUpload` → published asset, a re-upload of identical bytes returns the same asset with `reused: true`, an oversized upload is rejected, and a delete is refused while the asset is still referenced |
| `tests/integration/api-keys.test.ts` | 12 | the plaintext key is returned exactly once and only `sha256` is stored (`hashApiKey` matches the row, `keyPreview` is `prefix…lastFour`); a request with a valid key authenticates, an expired/revoked/unknown key is refused (never downgraded to anonymous); a scope the key does not hold is `403` while the granted scope passes; the IP allowlist is enforced; the per-minute rate limit triggers `429`; `logApiRequest` records method/path/status/duration and bumps `usageCount`/`lastUsedAt`; webhook subscriptions store the secret encrypted plus a hash, expose the secret once, and refuse an unknown event type; a delivery is signed (`sha256=<HMAC>` over the raw body, verified with `verifyPayloadSignature`), records its attempt, is deduplicated per `(eventType, dedupeKey)`, and retries a 503 with backoff before succeeding on 204; an event whose subscription is switched off is parked `DEAD` instead of retried forever |
| `tests/integration/marketing.test.ts` | 6 | server credentials stay encrypted and only public ids appear in configuration; only enabled browser pixels of that storefront are handed to the client; a consented `Purchase` queues one `PENDING` row while a non-consented one is stored as `SKIPPED_NO_CONSENT` and never delivered — and a replay with the same dedupe key does not create a second row, while a later consent **promotes** the skipped row instead of being blocked by it; a server delivery sends `event_id`, `value_paisa` and a bearer token with no raw personal data and ends `SENT`; a 503 marks the row `FAILED` with `attempts = 1`, `HTTP 503` and a future `nextAttemptAt`, a retry after the backoff becomes `SENT`, and an integration switched off discards its pending rows without any HTTP call; an unknown provider and a missing declared field are refused |

The three suites run against the real database and the real local storage driver
(`tests/setup.ts` forces `STORAGE_DRIVER=local` with `.cache/test-uploads`), so the
checksum-dedupe, signed-URL and "the upload did not reach storage" paths are exercised
rather than mocked. HTTP calls to providers are stubbed with `vi.stubGlobal("fetch", …)`
and never leave the machine.

## 7. Manual verification recorded per stage

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

Stage 5 smoke results: a landing page was created through `createPage` (three blocks: heading,
text, button), saved as a draft, published, edited, re-published and unpublished through the real
service calls, and the storefront was read back through `publishedPage` to prove the draft is never
live and the promotion is. Without a session cookie: `/`, `/products`, `/products/<slug>`, `/cart`,
`/robots.txt` and `/sitemap.xml` all returned `200` (the sitemap listed the home page, the product
listing, the seeded product and the new `/pages/stage-five` page), while `/pages/<missing>` returned
`404`. With a real session cookie: `/admin/pages`, `/admin/pages/new`, `/admin/pages/<id>`,
`/admin/pages/<id>/builder` (widget palette, 13 block types, Save draft / Publish controls and the
page's own blocks present in the payload) and `/admin/pages/<id>/preview` all returned `200`, and
the public URL `/pages/stage-five` rendered the published heading, text and button. `/admin/login`
without a cookie returned `307` to the login page.

## 8. Adding tests

1. Put pure logic in `tests/lib`, database behaviour in `tests/integration`.
2. Use `createTestBusiness()` from `tests/integration/fixtures.ts`; never touch the
   seeded demo business.
3. Assert on database state as well as return values — the ledger is the contract.
4. Prefer concurrent `Promise.all` assertions for anything that must survive races.
5. If a test exposes a real bug, fix the service and keep the test.

## 9. Not covered yet (deliberate)

- Browser/E2E automation (Playwright). The stage smoke passes are scripted HTTP checks with a
  real session cookie, not a browser run, so drag-and-drop gestures, keyboard navigation and
  responsive breakpoints were verified by hand in the browser rather than asserted.
- Payment/courier provider sandboxes — the adapters are covered by payload-builder and
  status-mapping tests; real provider calls are never made from tests. Pathao/Steadfast/CarryBee
  and bKash/SSLCommerz therefore remain unverified against live endpoints.
- Real S3 (MinIO/AWS) uploads: the suite runs the local driver. The S3 code path is the same
  `putObject`/`headObject`/signing interface, but it has not been exercised against a bucket here.
- SMTP/email and SMS delivery: providers are not configured in this environment.
- Load/soak testing and multi-node worker scheduling.
- The FK/constraint drift checker runs as `npm run db:check-fk` and requires a migrated
  database; it is not part of `npm run check` because it needs PostgreSQL.

### Global Media Manager regression coverage

See `tests/integration/media-manager.test.ts` and `tests/lib/media-*.test.ts`.
They cover shared-media lifecycle/concurrency, pending exclusion, content/hash/size
validation, owner/tenant isolation, S3 signatures, progress/retries, CSV attachments,
page history and safe cleanup. The policy test also scans application source for
module-local file inputs or independent S3 clients.

Browser smoke scenario (development storage, seeded staff account): open a new product,
open **Add gallery images**, upload a PNG, select it and cancel; assert no gallery hidden
input was added. Reopen, select the existing PNG and confirm; assert one media ID. Save
the product and verify that the same ID reloads. Open `/admin/media` and switch to list
view. Check the browser console for runtime errors. Production readiness additionally
requires exercising this flow against the actual S3-compatible bucket and its CORS.
