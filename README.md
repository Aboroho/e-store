# E-Store

A self-hosted commerce, inventory and order-management platform for a single business running
several storefronts on one catalogue: products, pricing, purchasing, warehouse stock, orders,
checkout with COD/bKash/SSLCommerz, courier dispatch (Pathao, Steadfast, CarryBee) with COD
settlement, exchanges, resellers and payouts, reporting with PDF/XLSX exports, a page builder,
a media library, customer reviews, scoped API keys with webhooks and marketing integrations.

Stack: Next.js 16 (App Router, React 19), TypeScript (strict), Tailwind 4, Zod, PostgreSQL 17,
Prisma 7, server actions + REST under `/api/v1`, S3-compatible object storage. Money is stored
as integer paisa (BDT × 100) — never floats.

## Run it locally

```bash
npm install
npm run db:start        # embedded PostgreSQL (downloads official binaries, no root needed)
npm run db:deploy       # apply migrations
npm run db:seed         # owner account, roles, districts, delivery zones, demo data
cp .env.example .env    # then fill in SESSION_SECRET and APP_ENCRYPTION_KEY
npm run dev             # http://localhost:3000
npm run worker          # in a second terminal: outbox, webhooks, marketing, tracking
```

The seed prints the owner email and password (`SEED_OWNER_PASSWORD` overrides the default) — sign
in at `/login` and change it immediately. Media uploads need a storage driver: `local` writes to
`LOCAL_STORAGE_DIR`, `s3` uses the bucket in `S3_*`, `disabled` makes uploads fail loudly.

## Quality gates

```bash
npm run check           # schema assembly check + tsc --noEmit + eslint
npx vitest run          # 137 tests (unit + database integration)
npm run build           # production build
npm run db:check-fk     # 209 foreign keys match the schema
```

## Documentation

| Document | Contents |
| --- | --- |
| `docs/FINAL_REPORT.md` | what was built per stage, gates actually run, limitations, next steps |
| `docs/ARCHITECTURE.md` | layers, request lifecycle, authorization, background work, flows, module map |
| `docs/DATABASE_DESIGN.md` | schema layout, inventory ledger, keys/soft deletion, migrations |
| `docs/BUSINESS_RULES.md` | every enforced rule (money, stock, pricing, orders, payouts, reviews, API) |
| `docs/API.md` | `/api/v1` envelope, endpoints, API keys, webhook signatures, conventions |
| `docs/SECURITY.md` | threat model, secrets, headers, rate limits, verification runbook |
| `docs/DEPLOYMENT.md` | VPS deployment, reverse proxy, storage, backups, upgrades, runbook |
| `docs/TESTING.md` | what each suite proves, how to run it, what is deliberately not covered |
| `docs/IMPLEMENTATION_PLAN.md` | the five stages, their deliverables and the defects found |
| `docs/PROJECT_AUDIT.md` | starting state, environment constraints, verification per stage |

`master-prompt.md` and `phase-1.md`…`phase-5.md` are the original specification and stage briefs.
