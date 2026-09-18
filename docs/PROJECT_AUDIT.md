# Project audit

Date: 2026-09-18 · Stage 1 (foundation, authentication, RBAC, admin shell)

This audit records what exists in the repository, what was verified by running it, and what is
still missing. It is updated at the end of every stage.

## 1. What was in the repository when work started

| Item | State |
| --- | --- |
| `master-prompt.md` | 65 KB specification (stack, data model groups A–R, workflows A–L, security, stages). |
| `phase-1.md` … `phase-5.md` | Stage breakdown used as the implementation order. |
| `package.json` / `package-lock.json` | Present, dependencies already listed. |
| Source code | **None** — no `src/`, no Prisma schema, no tests, no configuration. |
| Tooling | No ESLint config, no Vitest config, no CI, no docs folder. |

The repository was therefore a specification-only project: everything below was created in Stage 1.

## 2. Environment constraints discovered

| Constraint | Consequence / workaround |
| --- | --- |
| No access to `binaries.prisma.sh` (TLS disconnect) | The Prisma engine download fails. `prisma generate` runs with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (WASM validator); migrations are authored as SQL and applied by `scripts/migrate.mjs`, which writes a Prisma-compatible `_prisma_migrations` table (sha256 checksums). |
| `apt`/Docker unavailable | PostgreSQL is provided by the npm package `@embedded-postgres/linux-x64` (17.10), started by `scripts/dev-db.sh` on `127.0.0.1:5432`. |
| No `psql` binary in the embedded server | `scripts/pg-admin.mjs` performs database creation and SQL execution through the `pg` driver. |
| Only the npm registry, github.com and pypi are reachable | All dependencies are installed from npm; no CDN-loaded assets are used at runtime. |

## 3. Verification actually performed (Stage 1)

| Check | Command | Result |
| --- | --- | --- |
| Schema validity | `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma validate` | valid — 111 models, 73 enums |
| Client generation | `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate` | 111 model files generated into `src/generated/prisma` |
| Migration applied | `node scripts/migrate.mjs deploy` | `20260918000000_init_platform_schema` applied |
| Schema ↔ database drift | `node scripts/schema-tool.mjs check` | `OK: database matches prisma/schema.prisma` |
| Seed | `npm run db:seed` | 64 districts, 64 permissions, 7 roles, owner account, warehouse, storefront, 64 delivery zones, 5 exchange reasons, 7 number sequences |
| Types | `npx tsc --noEmit` | 0 errors |
| Lint | `npx eslint .` | 0 errors / 0 warnings |
| Tests | `npx vitest run` | 50 passed (45 unit, 5 database integration) |
| Production build | `npm run build` | succeeded (Next.js 16.3.5, 12 routes) |
| Sign-in end-to-end | curl against `next dev` | `/login` 200; `/admin` without cookie → 307 to `/login`; with a session cookie → 200 rendering real dashboard data |

Not yet verified (no environment available in the sandbox): real SMTP delivery, real courier/bKash/
SSLCommerz sandbox calls, S3 bucket uploads, load/performance behaviour.

## 4. Known gaps and risks

| # | Gap | Impact | Plan |
| --- | --- | --- | --- |
| 1 | Email delivery is not wired (no SMTP credentials) | Password reset links and invitations cannot be emailed | Password reset stores a single-use token; in non-production the link is returned to the operator. SMTP integration is part of Stage 5 hardening; until then the reset flow is exercised locally. |
| 2 | S3 storage driver is not implemented yet | Media uploads are impossible | Media manager + driver land in Stage 5; `STORAGE_DRIVER=disabled` currently reports the capability as unavailable instead of pretending to work. |
| 3 | `prisma migrate dev` cannot run offline | New migrations must be authored as SQL | `scripts/schema-tool.mjs sql --out <dir>/migration.sql` generates DDL from the schema; reviewed manually and applied with `scripts/migrate.mjs`. |
| 4 | Covering indexes/FK actions are not compared by the drift checker | A hand-edited database could drift silently | The checker verifies tables, columns, nullability and enums; FK/index comparison is a follow-up task. |
| 5 | Navigation advertises later-stage screens | Users could expect features that do not exist | Nav items carry a `stage` field; anything above the current stage renders disabled with an "S5"-style badge instead of a dead link. |
| 6 | No CI pipeline | Regressions rely on the developer running `npm run check` | A GitHub Actions workflow is planned in Stage 5 (documented in DEPLOYMENT.md). |

## 5. Repository map (Stage 1)

```
prisma/
  parts/*.prisma            schema sources, assembled into schema.prisma
  migrations/               SQL migrations + extra constraints
  seed.ts, seed/            idempotent seed data
scripts/                    database + schema tooling, schema assembly
src/generated/prisma/       generated client (not committed)
src/lib/                    environment, db, money, crypto, auth, permissions, settings, validation
src/components/             UI primitives, layout shell, forms
src/modules/                auth, users, dashboard, notifications, settings (service + actions)
src/app/                    admin area, auth pages, global styles
tests/                      unit and database integration tests
docs/                       this audit plus architecture and plan documents
```
