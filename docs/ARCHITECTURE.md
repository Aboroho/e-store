# Architecture

A modular monolith: one Next.js application, one PostgreSQL database, one background worker.
Modules own their tables and expose services; nothing reaches across module boundaries by
importing another module's internals.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ App Router (src/app)                                                 │
│   • React Server Components render data                              │
│   • Server Actions handle form submissions                           │
│   • Route Handlers expose the public REST API under /api/v1          │
├──────────────────────────────────────────────────────────────────────┤
│ UI layer (src/components)                                            │
│   • primitives.tsx (server-safe) · interactive.tsx ("use client")     │
│   • layout/ shell, navigation, icon map                              │
│   • forms/ one client component per form, wired to server actions     │
├──────────────────────────────────────────────────────────────────────┤
│ Modules (src/modules/<name>/{service,actions,schemas,queries}.ts)     │
│   • business rules, permission checks, transactions, audit records    │
├──────────────────────────────────────────────────────────────────────┤
│ Library (src/lib)                                                    │
│   • env, db client, errors, money, crypto, logging, utils             │
│   • auth (password, sessions), permissions, settings, validation      │
│   • audit, rate-limit, idempotency, numbering, api responses          │
├──────────────────────────────────────────────────────────────────────┤
│ Data (Prisma 7 + PostgreSQL 17)                                      │
│   • prisma/parts/*.prisma assembled into prisma/schema.prisma          │
│   • SQL migrations applied by scripts/migrate.mjs                     │
└──────────────────────────────────────────────────────────────────────┘
```

Rules enforced by review and tooling:

- `src/lib/*` never imports from `src/modules/*` (no cycles, no accidental coupling).
- Anything under `src/lib` that touches the database or secrets imports `server-only`, so it can
  never be bundled into a client component.
- Modules never trust client input: every figure a client submits (price, quantity, role, id) is
  re-read or re-derived on the server before it is written.

## 2. Request lifecycle

1. **Proxy** (`src/proxy.ts`, formerly `middleware.ts`) performs a cookie-presence redirect for
   `/admin/*`. It is a convenience gate only.
2. **Server Component / Action** calls `requireSession()`, which resolves the session cookie to a
   database row (hashed token), checks expiry/revocation, and loads the user's roles *and*
   permissions in one query.
3. The page or action calls `assertPermission(session, "permission.key")`. Failure raises
   `AppError(FORBIDDEN)`, which the action turns into a flash message and the API turns into a 403.
4. The service performs the write inside `withTransaction()` when more than one row changes, and
   appends an `AuditLog` row for privileged operations.
5. The response is revalidated (`revalidatePath`) so the UI shows the committed state.

## 3. Data model principles

| Principle | Implementation |
| --- | --- |
| Single business, one inventory location | Every business-owned row carries `businessId`; `InventoryLocation` records the site (the schema supports more, the UI ships one). |
| Money is exact | All amounts are `Int` paisa. The UI parses/validates with `zMoneyPaisa` and formats with `formatPaisa`. No float arithmetic anywhere in the money path. |
| Inventory is a ledger | `InventoryBalance` holds the current counters; `InventoryMovement` is an append-only signed ledger. Counters are never negative (`CHECK` constraints) and every change writes a movement in the same transaction. |
| Idempotency | `IdempotencyRecord` (key + payload hash) guards order creation, payments and webhooks; `dedupeKey`/`providerEventId` uniques guard outbox and webhook replays. |
| Auditing | `AuditLog` is append-only with before/after JSON, actor, IP and request id. |
| Sessions | Staff sessions (`Session`) are separate from customer sessions (`CustomerSession`); both store only a SHA-256 hash of the token. |
| Numbers | `NumberSequence` allocates document numbers atomically inside the caller's transaction. |

Full table list: see `docs/DATABASE_DESIGN.md` (Stage 2) — the schema itself is the source of truth
(`prisma/parts/*.prisma`).

## 4. Authorisation model

- A **permission** is a stable string (`order.update`, `inventory.adjust`, …) defined once in
  `src/lib/permissions/catalog.ts` and seeded into the `Permission` table.
- A **role** is a named set of permissions; seven templates (owner, administrator, inventory staff,
  order staff, customer support, finance, reseller) are seeded per business.
- The **owner** account implicitly holds every permission and cannot be demoted, suspended or
  deleted; the owner role cannot be edited and no other role may hold `*`.
- UI filtering (`can`) is a usability feature; `assertPermission` on the server is the boundary.
  Both read from the same catalogue so they cannot drift.

## 5. Background work (introduced in Stage 3, used from Stage 4)

External calls (courier booking, SMS, email, webhook delivery) never run inside a database
transaction. Instead a module writes an `OutboxEvent` in the same transaction as its state change;
`scripts/worker.ts` (Stage 3) claims events with `FOR UPDATE SKIP LOCKED`, performs the call, and
records the result. Failures are retried with exponential backoff and dead-lettered to
`BackgroundJob` after a configurable attempt limit.

## 6. Stage 1 runtime topology

- `npm run dev` / `npm run build && npm start` — the application (port 3000).
- PostgreSQL 17 (embedded locally, managed service in production).
- No worker process is needed yet; `npm run worker` is added in Stage 3.

## 7. Failure handling

- Services throw `AppError` with a stable code (`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `INSUFFICIENT_STOCK`, `RATE_LIMITED`, …). Server actions convert these into field
  errors; API routes convert them into the documented JSON envelope.
- Unexpected errors are logged as single-line JSON through `src/lib/logging.ts`, which redacts
  secrets (cookies, tokens, passwords, `Authorization` headers) before writing.
- React error boundaries (`error.tsx`) present a recoverable message with the error digest; the
  full stack stays on the server.
