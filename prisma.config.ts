import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * The database connection URL is configured here (no longer inside
 * `schema.prisma`) and is consumed by the Prisma CLI for migrations.
 * The runtime client receives its connection through a driver adapter in
 * `src/lib/db/client.ts`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Allow `prisma generate` / `prisma validate` to run without a live DATABASE_URL
    // (the Prisma Client generator is WASM-based and does not need a DB connection).
    // Fall back to a dummy local URL so the CLI can load the config in air-gapped CI.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/estore?schema=public",
    // shadowDatabaseUrl:
    //   process.env.SHADOW_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/estore_shadow?schema=public",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
