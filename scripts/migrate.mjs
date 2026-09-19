#!/usr/bin/env node
/**
 * Migration runner for the E-Store platform.
 *
 * Applies the versioned SQL migrations in `prisma/migrations` using the same
 * bookkeeping table that Prisma Migrate uses (`_prisma_migrations`), so a
 * deployment can use either this runner or `prisma migrate deploy` — the files
 * are the single source of truth.
 *
 * Usage:
 *   node scripts/migrate.mjs deploy   # apply all pending migrations
 *   node scripts/migrate.mjs status   # show applied / pending migrations
 *   node scripts/migrate.mjs baseline # mark migrations as applied without running them
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MIGRATIONS_DIR = process.env.PRISMA_MIGRATIONS_DIR ?? "prisma/migrations";

async function loadPg() {
  const candidates = [
    process.env.PG_CLIENT_PATH,
    `${process.cwd()}/node_modules/pg/lib/index.js`,
    `${process.env.HOME}/.cache/pg-dev/node_modules/pg/lib/index.js`,
    "pg",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try next */
    }
  }
  throw new Error("pg client library not found");
}

async function loadEnvFile() {
  if (process.env.DATABASE_URL) return;
  for (const file of [".env.local", ".env"]) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([\w.]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
      }
    } catch {
      /* file missing */
    }
  }
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();
}

function readMigration(name) {
  const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
  const sql = fs.readFileSync(file, "utf8");
  return { name, sql, checksum: crypto.createHash("sha256").update(sql).digest("hex") };
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
}

async function appliedMigrations(client) {
  const { rows } = await client.query(
    `SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  return new Map(rows.map((row) => [row.migration_name, row]));
}

async function deploy({ baseline = false } = {}) {
  await loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const migrations = listMigrations().map(readMigration);
  let appliedCount = 0;
  let failed = false;
  try {
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        const existing = applied.get(migration.name);
        if (existing.checksum && existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after it was applied (checksum mismatch). ` +
              "Create a new migration instead of editing an applied one.",
          );
        }
        continue;
      }
      if (baseline) {
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
           VALUES ($1, $2, now(), $3, 0)`,
          [crypto.randomUUID(), migration.checksum, migration.name],
        );
        console.log(`baselined ${migration.name}`);
        continue;
      }
      console.log(`Applying ${migration.name} ...`);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
           VALUES ($1, $2, now(), $3, 1)`,
          [crypto.randomUUID(), migration.checksum, migration.name],
        );
        await client.query("COMMIT");
        appliedCount += 1;
        console.log(`  applied ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED ${migration.name}: ${error.message}`);
        failed = true;
        break;
      }
    }
    if (!failed) {
      console.log(
        appliedCount === 0 ? "Database is up to date." : `Applied ${appliedCount} migration(s) successfully.`,
      );
    }
  } finally {
    await client.end();
  }
  if (failed) process.exitCode = 1;
}

async function status() {
  await loadEnvFile();
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);
    for (const migration of listMigrations().map(readMigration)) {
      const row = applied.get(migration.name);
      console.log(`${row ? "[applied]" : "[pending]"} ${migration.name}`);
    }
  } finally {
    await client.end();
  }
}

const [, , command = "deploy"] = process.argv;

try {
  if (command === "deploy") await deploy();
  else if (command === "baseline") await deploy({ baseline: true });
  else if (command === "status") await status();
  else {
    console.error("Usage: migrate.mjs <deploy|status|baseline>");
    process.exit(1);
  }
} catch (error) {
  console.error(`Migration error: ${error.message}`);
  process.exit(1);
}
