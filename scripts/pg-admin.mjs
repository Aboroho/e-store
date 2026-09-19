#!/usr/bin/env node
/**
 * Minimal PostgreSQL admin helper used by scripts/dev-db.sh.
 *
 * The npm-distributed PostgreSQL build used for local development contains only
 * the server binaries (postgres, initdb, pg_ctl) and no psql client, so this
 * helper performs the small set of administrative tasks the dev script needs.
 *
 * Commands:
 *   ensure-databases  Create the databases if they do not exist yet.
 *   sql               Run a SQL statement / query.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function loadPg() {
  const candidates = [
    process.env.PG_CLIENT_PATH,
    `${process.env.HOME}/.cache/pg-dev/node_modules/pg/lib/index.js`,
    "pg",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("pg client library not found; run `npm install` in the project first");
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    } else {
      args._.push(token);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const [command] = args._;
const host = args.host ?? "127.0.0.1";
const port = Number(args.port ?? 5432);
const user = args.user ?? "postgres";

if (!command) {
  console.error("Usage: pg-admin.mjs <ensure-databases|sql> [options]");
  process.exit(1);
}

const pg = await loadPg();

async function connect(database) {
  const client = new pg.Client({ host, port, user, database, password: process.env.PGPASSWORD });
  await client.connect();
  return client;
}

if (command === "ensure-databases") {
  const databases = (args.databases ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const client = await connect("postgres");
  try {
    for (const database of databases) {
      const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (rowCount === 0) {
        await client.query(`CREATE DATABASE "${database.replace(/"/g, "")}"`);
        console.log(`Created database ${database}`);
      } else {
        console.log(`Database ${database} already exists`);
      }
    }
  } finally {
    await client.end();
  }
} else if (command === "sql") {
  const statement = args._.slice(1).join(" ");
  if (!statement) {
    console.error("No SQL statement provided");
    process.exit(1);
  }
  const client = await connect(args.database ?? "postgres");
  try {
    const result = await client.query(statement);
    if (result.rows?.length) {
      console.table(result.rows);
    } else {
      console.log(`${result.command ?? "OK"} ${result.rowCount ?? ""}`.trim());
    }
  } finally {
    await client.end();
  }
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
