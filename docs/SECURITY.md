# Security

How this application is built to be safe to expose on the public internet, what an
operator must do, and what is deliberately out of scope for v1.

> Nothing in this document is a claim that the system has been penetration tested. It
> describes the controls that exist in code, where they are enforced, and how to verify
> them. Run through [Verification](#verification) after every deployment.

## 1. Trust boundaries

| Caller                              | Authenticated by                                        | Authorised by                                        |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Admin user (browser)                | `estore_session` cookie, server-side session rows       | `can(session, "<permission>")` on every page/action  |
| Storefront shopper (browser)        | no session (or a customer session for `/account`)       | server-side validation + rate limiting               |
| Integrator (server to server)       | `Authorization: Bearer esk_…` or `X-API-Key`            | API key scopes, checked per endpoint                 |
| Courier / payment gateway (webhook) | provider signature or shared secret, verified in code   | provider-specific; unmatched events are rejected     |
| Background worker                   | database claim queries (`UPDATE … WHERE status = …`)    | runs with the app's own credentials                  |

The browser is never trusted for money, roles or IDs: every price, discount, delivery
fee, tax figure, stock movement and permission decision is recomputed from the database
inside the request that needs it.

## 2. Authentication and sessions

- Passwords are hashed with bcrypt (`src/lib/auth/password.ts`). Login is rate limited
  per email + IP, and failed attempts are audited.
- Sessions are opaque random tokens. Only the SHA-256 hash is stored; the cookie is
  `httpOnly`, `sameSite=lax`, `secure` in production, and expires (`src/lib/auth/session.ts`).
- Password reset tokens are single-use, hashed at rest and short-lived.
- The edge proxy (`src/proxy.ts`) performs a cheap "is there a cookie at all?" redirect
  for `/admin`, purely to avoid rendering the shell for signed-out visitors. It is **not**
  the authorisation boundary — every page, server action and route re-checks the session.

## 3. Authorisation

- Permissions live in `src/lib/permissions/catalog.ts` (`PERMISSIONS`, role presets) and
  are enforced with `assertPermission(session, "…")` in server actions and pages, and
  `can(session, "…")` inside services that can be reached from more than one entry point.
- Hiding a navigation item is a usability decision only; it never gates access. The nav
  config and the pages assert the same permission.
- Every server action is written the same way: resolve the actor, assert the permission,
  validate input with Zod, call the service, audit the change.

## 4. API keys

- Keys are generated with `crypto.randomBytes` and shown **once**. Only the SHA-256 hash,
  the public prefix and the last four characters are stored (`ApiKey.keyHash`).
- A key carries: scopes, an optional expiry, an optional IP allowlist, and its own
  requests-per-minute limit. A key that expires flips to `EXPIRED` on the next use.
- Lookup is by prefix, then a constant-time comparison of the hash, so a wrong secret is
  indistinguishable from an unknown prefix.
- Every authenticated call is written to `ApiRequestLog` (method, path, status, duration,
  key, error code) and is visible on `/admin/api-keys`.
- Scopes are checked per endpoint with `assertScope`. Customer contact details are only
  returned to a caller that may see them; the same endpoint masks the phone number
  otherwise — there is no "all scopes" key.

## 5. Secrets at rest and in transit

- Provider credentials (courier tokens, payment gateways, marketing API secrets) are
  encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` and stored in
  `IntegrationSecret`. They are never returned to a browser or written to a log.
- Marketing pixels receive only public ids, validated against the provider's pattern
  before they are rendered; anything else is dropped.
- `docs/` and the repository contain no real credentials. `.env` is git-ignored;
  `.env.example` holds placeholders only. `env()` refuses to boot in production with the
  development defaults or without an S3 bucket when the S3 driver is selected.
- Media uploads use short-lived signed URLs. With the local driver the signature covers
  the operation, key, expiry, content type and disposition; with S3 the bucket URL is
  presigned. Downloads of private assets always go through a signed URL.

## 6. Input validation and injection

- Every action and route validates its input with a Zod schema (`src/lib/validation.ts`
  helpers convert `FormData`). Unknown fields are dropped; numbers are bounded; IDs are
  UUIDs checked against the actor's business.
- All database access goes through Prisma's parameterised queries; there is no string
  concatenation of SQL anywhere in the codebase. Raw SQL is limited to `SELECT 1` in the
  health check and the migration tooling.
- React escapes by default. Page-builder content is stored as validated JSON and rendered
  through a registry of trusted components — block props are re-parsed against their
  schema at render time, and an HTML block is sanitised before it is shown.
- Uploaded file names are never used as paths: object keys are generated.

## 7. Rate limiting and abuse control

`src/lib/rate-limit.ts` provides a database-backed limiter (`consumeRateLimit`,
`enforceRateLimit`) so limits survive restarts and work across processes:

| Surface                    | Limit (default, `RateLimits`)        |
| -------------------------- | ------------------------------------ |
| Staff login                | 8 attempts / 5 min per email + IP    |
| Password reset request     | 5 / 15 min per email                 |
| Verification codes         | 5 requests and 10 checks / 15 min    |
| Storefront checkout        | 10 orders / 10 min per IP            |
| Admin/API order creation   | 20 / 10 min per session or key       |
| Order tracking lookup      | 20 / 15 min per order number         |
| Review submission          | 10 / hour per customer (uploads and reports share it) |
| API keys                   | per key, default 120 / min           |
| Webhook + marketing worker | 300 / min per subscription/provider  |

## 8. Transport, headers and cookies

`next.config.ts` sets, for every response: `Content-Security-Policy` (self by default;
scripts and connections additionally allow the two pixel hosts the storefront may load,
`object-src 'none'`, `frame-ancestors 'self'`), `Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Permissions-Policy`, and HSTS in production. Admin responses are
`no-store`. Cookies are `secure` in production, so the app must run behind TLS.

The policy allows `'unsafe-inline'` for scripts because the Next.js App Router bootstraps
with inline scripts; a nonce-based policy would require an edge hook and is noted as a
hardening step, not a shipped control. With `NODE_ENV=production` a missing TLS
terminator will produce "secure cookie not stored" symptoms rather than security.

## 9. Auditing and monitoring

- `recordAudit` writes who did what, to which entity, before/after values and a reason,
  for every state change (orders, stock, payouts, settings, API keys, plugins). The
  `/admin/audit` screen filters it.
- Authentication failures are logged; the API request log is queryable per key.
- The health endpoint (`/api/health`) reports database reachability, storage
  configuration and worker lag, and returns 503 when the database is unreachable.

## 10. Known limits (v1)

- Single business, single inventory location: there is no tenant isolation layer.
- No third-party plugin code is executed; plugins are trusted, registered extensions.
- No WAF or bot detection: put nginx/Caddy and a firewall in front, as in
  `docs/DEPLOYMENT.md`.
- 2FA is not implemented; protect the admin with a long password, TLS and an IP allowlist
  at the proxy if the deployment allows it.

## Verification

Run these after each deployment:

```bash
npm run check          # schema assembly, typecheck, lint
npm run db:check-fk    # foreign-key integrity
npm run test           # unit + integration tests
npm run build          # production build

# environment sanity: fails loudly with development secrets in production
NODE_ENV=production APP_URL=https://your-domain \
  DATABASE_URL=… SESSION_SECRET=… APP_ENCRYPTION_KEY=… \
  node -e "require('node:child_process')" >/dev/null; npm run db:status

# no secrets in the bundle (run after `npm run build`)
grep -rIn "S3_SECRET_ACCESS_KEY\|APP_ENCRYPTION_KEY\|sk_live" .next/static | head
```

Manual checks worth repeating: sign in as each preset role and confirm the pages they
should not reach return 403/404; try to place a storefront order with a tampered price;
call an API endpoint with a key that lacks the scope; delete a media asset that is in use;
open a webhook endpoint that returns 500 and watch the retry/backoff rows.
