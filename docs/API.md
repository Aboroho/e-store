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

## Webhooks and retries

* Provider calls outbound (courier booking, status polling) run in the worker: the web
  request writes an `OutboxEvent` in the same transaction as the shipment and returns.
* Failures retry with exponential backoff (`30s × 2^attempt`, capped at 1 hour) up to
  `OutboxEvent.maxAttempts`, then the event is marked `FAILED` and the shipment keeps the
  reason in `failureReason` so an operator can requeue it from the UI.
* `npm run worker` runs continuously; `npm run worker:once` drains the queue once (useful
  in cron).

## Conventions for integrators

1. **Money is integer paisa** everywhere (`189_000` = ৳1,890.00). Never send decimals.
2. **Send an idempotency key** on every write; keys are unique per business.
3. **Do not send derived values** (prices, totals, stock). They are computed server-side;
   unknown fields are rejected rather than silently ignored.
4. **Timestamps are ISO-8601 UTC**; the business timezone (`Asia/Dhaka` by default) is
   applied for reporting only.
5. **Pagination is 1-based** with `pageSize` ≤ 100.
