# HTTP API — `/api/v1`

The REST surface is a thin layer over the same services the admin screens call, so an
integration can never do something the UI cannot, and every rule (permissions, pricing,
stock, idempotency) is enforced in one place.

Nothing here is a mock: every endpoint reads and writes PostgreSQL through the modules in
`src/modules/*`. Payment providers and couriers are called by the outbox worker
(`npm run worker`), never inside a request transaction.

## Envelope

```jsonc
// success
{ "data": { /* payload */ }, "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }

// failure
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {…}, "hint": "…", "requestId": "…" } }
```

Stable error codes come from `src/lib/errors.ts`: `VALIDATION_ERROR`, `UNAUTHENTICATED`,
`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`, `INSUFFICIENT_STOCK`,
`RATE_LIMITED`, `INTEGRATION_ERROR`, `UNPROCESSABLE`, `INTERNAL_ERROR`. All responses are
`Cache-Control: no-store`; 5xx responses are logged with their `requestId`.

## Authentication

| Caller | Credential | Used by |
| --- | --- | --- |
| Staff | `estore_session` cookie (opaque 256-bit token, hashed at rest) | admin screens, orders API |
| Shopper | `estore_customer_session` cookie, issued only after a one-time code is verified | order tracking |
| Provider | HMAC signature over the raw body with the encrypted webhook secret | courier and payment callbacks |
| Integration | `Authorization: Bearer esk_…` or `X-API-Key: esk_…`, scoped | outbound product/order/report reads and writes |

Staff endpoints check the session **and** the permission server-side (`can(session, …)`);
a hidden button is never the only guard. Anonymous order tracking requires both the order
number and the phone number used on the order, and is rate limited.

## Endpoints

### `GET /api/v1/orders`

Staff only (`order.view`). Query parameters: `search`, `status`, `paymentStatus`,
`fulfillmentStatus`, `channel`, `storefrontId`, `customerId`, `resellerId`, `from`, `to`,
`page`, `pageSize`, `sortBy`, `sortDir`. Returns order rows with line summaries and
shipment summaries, plus pagination `meta`.

### `POST /api/v1/orders`

Staff only (`order.create`). Body is the same shape the admin "New order" form posts
(`createOrderInputSchema`). Money is **integer paisa**; a caller may pass
`priceListId`, never a price.

```jsonc
{
  "channel": "API",
  "storefrontId": "…",              // optional, decides the price list
  "customerName": "Rahim Uddin",
  "customerPhone": "01712345678",
  "shippingDistrictCode": "26",
  "shippingAddressLine": "12 Station Road, Ishwardi",
  "items": [{ "variantId": "…", "quantity": 2 }],
  "idempotencyKey": "erp-order-0001" // optional but recommended
}
```

Returns `{ order: { id, orderNumber, status, grandTotalPaisa, duePaisa }, reservedUnits, preorderUnits, reused }`.
`reused: true` means the idempotency key was already used and the original order is
returned unchanged — retrying a request can never create a second order or reserve stock
twice.

### `GET /api/v1/orders/{orderNumber}`

Order tracking. Staff with `order.view` may read any order; anyone else must supply the
phone number (`?phone=01712345678`) and receives a reduced payload (status, items,
shipments with tracking codes, amounts) with no customer PII beyond what they typed.
Rate limit: 20 requests / 15 minutes per IP + order. Responses for a wrong phone number
are indistinguishable from a missing order.

### `POST /api/v1/customers/verification`

Requests a one-time code for the phone in the body (`{ "phone": "017…" }`). The same
endpoint serves sign-in and guest-order claiming, so the response cannot reveal whether an
account exists: it always reports the delivery channel and whether the code was delivered,
and rate limits apply per IP **and** per phone number. The code itself is never returned
here — it is delivered out of band, or (when no SMS gateway is configured) read by staff
on the customer screen and typed into the counter.

### `PUT /api/v1/customers/verification`

Consumes the code (`{ "phone": "017…", "code": "123456" }`), sets the customer session
cookie and returns `{ customerId, claimedOrders, orders }`. Guest orders placed with that
phone number are claimed in the same transaction. Codes are single-use, expire after 10
minutes, and failed attempts are counted and rate limited.

### `POST /api/v1/payments/bkash/callback` · `POST /api/v1/payments/sslcommerz/callback`

Provider → platform. The body is parsed, the signature is verified server-side
(bKash token/`trxID` validation, SSLCommerz `md5(secret + sorted key=values + secret)`),
and only then is `processProviderEvent` called. Each call is stored in `PaymentEvent`
keyed by `(providerName, providerEventId)`: a replay is recorded and ignored, never paid
twice. A browser redirect alone never marks an order paid — the amount is checked against
the payment attempt before a `Payment` row is written.

### `POST /api/v1/couriers/{provider}/webhook`

Provider → platform, `provider` ∈ `pathao | steadfast | carrybee`. The signature header
is provider-specific (`X-PATHAO-Signature`, `Authorization`, `X-CB-Signature`) and is
verified with HMAC-SHA256 over the raw body using the encrypted `webhook_secret`. The
event is stored in `CourierWebhookEvent` (unique per provider event), resolved to a
shipment by consignment id or tracking code, and applied through the same status machine
the admin UI uses. Unknown tracking codes are stored as `IGNORED` and return `200` so the
provider stops retrying.

### `GET /api/v1/reports/{key}/export`

Downloads a report. Requires the same `report.view` permission as the screen plus
`report.export`; cost and profit columns are stripped for users without `report.view_cost`.

| Query | Values | Notes |
| --- | --- | --- |
| `format` | `pdf` (default) or `xlsx` | anything else is a `422` |
| `from` / `to` | `YYYY-MM-DD` | defaults to the last 30 days; point-in-time reports ignore it |

The response is always an attachment (`Content-Disposition: filename="<report>-<from>_<to>.<ext>"`),
`Cache-Control: no-store`, and the export is recorded in the audit log. An unauthenticated
browser request is redirected to `/admin/login?next=…` rather than returning JSON, because
this endpoint is reached by clicking a link.

`key` is one of: `sales-by-date`, `sales-by-product`, `inventory-valuation`,
`inventory-movements`, `damaged-stock`, `preorders-outstanding`, `purchase-history`,
`profit-summary`, `payments-collected`, `courier-charges`, `reseller-earnings`.

### `GET /api/v1/media/storage/upload` · `GET /api/v1/media/storage/download`

The signed-URL endpoints behind the media manager. The browser holds no storage credential:
`requestUpload()` (admin action) returns a one-time signed target, and these routes validate the
signature, expiry and object key before streaming. They answer `404` unless the local driver is
active, `410` when the signature has expired, `403` on a bad signature and `413` above the
64 MB hard cap. In S3 mode the equivalent URLs come straight from the bucket, so these routes
stay dormant.

| Query | Values | Notes |
| --- | --- | --- |
| `key` | object key | namespaced per business; path traversal is rejected |
| `expires` | unix seconds | short TTL, checked server-side |
| `signature` | hex HMAC-SHA256 | `put`/`get` scoped, constant-time compared |

### `GET /api/health`

Unauthenticated liveness probe for the reverse proxy and uptime monitor. Returns
`200 {"status":"ok","service":…,"time":…,"checks":[{"name":"database"|"storage"|"worker","status":…}]}`
and `503` when the database is unreachable. It reports only healthy/degraded per component —
never versions, configuration values, counts or error text.

## API keys

Machine clients authenticate with `Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys look
like `esk_<prefix>.<secret>`; only `sha256` of the full plaintext is stored, and the secret is
displayed exactly once at creation.

| Property | Behaviour |
| --- | --- |
| Scopes | `products:read`, `orders:read`, `orders:write`, `shipments:read`, `customers:read`, `reports:read`. Every request is checked against the scope the endpoint declares. |
| Expiry / revocation | `expiresAt` and `status` (`ACTIVE`, `REVOKED`, `EXPIRED`); a revoked key fails immediately. |
| IP allowlist | optional CIDR list; a request from outside it is `403`. |
| Rate limit | 120 requests/minute per key; `X-RateLimit-*` and `429` with `Retry-After` when exceeded. |
| Last used / usage | `usageCount` and `lastUsedAt` are bumped per authenticated request; `ApiRequestLog` records method, path, status and duration. |
| Unknown fields | a write payload with unknown fields is rejected (`422`), never silently ignored. |

An invalid, expired or revoked key is an error — the request is never downgraded to an anonymous
one. Staff sessions that hit the same routes keep their permission check, so an API scope can
never widen a session's access.

## Webhook subscriptions

Subscriptions are per event type: `order.created`, `order.confirmed`, `order.dispatched`,
`order.delivered`, `order.cancelled`, `payment.recorded`, `payment.refunded`,
`shipment.updated`, `shipment.delivered`, `review.approved`, `reseller.payout_paid`,
`inventory.low_stock`.

* The signing secret (`whsec_…`) is shown once; it is stored encrypted (AES-256-GCM) with a
  separate hash for verification.
* Every delivery carries `X-EStore-Event`, `X-EStore-Delivery` and
  `X-EStore-Signature: sha256=<HMAC-SHA256 of the raw body>` — verify with
  `verifyPayloadSignature`, which strips the prefix before comparing.
* Payloads are capped at 64 KB, delivered with a 10-second timeout, and retried with backoff
  until the subscription is paused/deleted (then the delivery is parked as `DEAD`).
* Deliveries are deduplicated per `(eventType, dedupeKey)`, so a replayed domain action cannot
  double-notify a consumer.

## Webhooks and retries

* Provider calls outbound (courier booking, status polling) run in the worker: the web
  request writes an `OutboxEvent` in the same transaction as the shipment and returns.
* Failures retry with exponential backoff (`30s × 2^attempt`, capped at 1 hour) up to
  `OutboxEvent.maxAttempts`, then the event is marked `FAILED` and the shipment keeps the
  reason in `failureReason` so an operator can requeue it from the UI.
* `npm run worker` runs continuously; `npm run worker:once` drains the queue once (useful
  in cron). The same worker drains webhook deliveries and marketing events (see above) and
  is observable at `/admin/jobs`.
* Marketing conversion events follow the same pattern per integration: `PENDING` → `SENT`,
  or `FAILED` with backoff, or `SKIPPED_NO_CONSENT`/discarded when the visitor declined or
  the integration was switched off.

## Conventions for integrators

1. **Money is integer paisa** everywhere (`189_000` = ৳1,890.00). Never send decimals.
2. **Send an idempotency key** on every write; keys are unique per business.
3. **Do not send derived values** (prices, totals, stock). They are computed server-side;
   unknown fields are rejected rather than silently ignored.
4. **Timestamps are ISO-8601 UTC**; the business timezone (`Asia/Dhaka` by default) is
   applied for reporting only.
5. **Pagination is 1-based** with `pageSize` ≤ 100.

## Manual Orders & Governance Actions

The manual order management system provides high-performance Next.js server actions under `@/modules/orders/manual-actions`:

* **`searchOrderProductsAction(query, storefrontId?)`**: Search catalog products by name, SKU, or category; returns live pricing and stock availability (available, reserved, uncovered).
* **`previewManualOrderAction(input)`**: Calculate server-authoritative order totals, item subtotals, proportional discount shares, delivery fees, and field validation errors before submission.
* **`createManualOrderAction(input)`**: Create an order in `PROCESSING` (or `COMPLETED` for in-store sales); executes stock reservation/preorder commitments transactionally.
* **`updateManualOrderAction(input)`**: Update pre-courier order details (or post-courier with explicit permission and confirmed override).
* **`lookupCustomerPhoneAction(phone)`**: Async lookup of customer profiles, saved addresses, and past order delivery addresses.
* **`changeOrderStatusAction(input)`**: Transition order status with server-enforced status group permissions and reason validation.
* **`bulkChangeOrderStatusAction(input)`**: Batch update order statuses; skips ineligible orders with detailed reasons.
* **`sendOrdersToCourierAction(input)`**: Bulk dispatch confirmed online delivery orders to couriers with duplicate prevention.
* **`deleteCancelledOrderAction(input)`**: Permanently delete a cancelled order; captures an `OrderDeletionRecord` snapshot while preserving customer profile and inventory ledger rows.
* **`saveCheckoutFieldAction(input)` / `loadCheckoutFieldsAction(storefrontId?)`**: Manage required and enabled checkout fields per storefront.
* **`saveOrderColumnsAction(columns)`**: Persist user column preferences for the order management data grid.

## Steadfast Courier Webhook Integration

* **Endpoint**: `/api/v1/couriers/steadfast/webhook`
* **Authentication**: Verified using Bearer token authorization matching the configured `webhook_secret` integration credential.
* **Payload Handling**: Processes `delivery_status` notifications (`consignment_id`, `invoice`, `status`, `cod_amount`). Maps delivery outcomes to domain statuses (`DELIVERED`, `PARTIALLY_DELIVERED`, `RETURNED`) with automatic restock inspection triggers and reseller earnings reconciliation.
