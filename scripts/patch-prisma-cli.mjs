#!/usr/bin/env node
/**
 * Patch Prisma CLI to allow offline `prisma generate` / `prisma validate`.
 *
 * Prisma 7's CLI unconditionally calls `ensureNeededBinariesExist` for
 * `generate`/`validate` which tries to download `schema-engine` from
 * `binaries.prisma.sh`. In sandboxed / air-gapped environments that host is
 * blocked (SNI-filtered TLS), so `prisma generate` fails even though the
 * Prisma Client generator (`prisma-client` provider, runtime `nodejs`) does
 * NOT need `schema-engine` — it is a WASM-based generator that only needs
 * the local `prisma_schema_build_bg.wasm` + `query_compiler` wasm files that
 * are already inside `node_modules/prisma/build`.
 *
 * This script removes `generate`/`validate`/`format` from the CLI's
 * `ensureBinaries` list so they run without a network round-trip. It is safe
 * to run multiple times and is a no-op if the file is already patched or if
 * Prisma is not installed.
 *
 * It is invoked automatically by `npm run db:generate` / `db:validate` so
 * that `npm run build` keeps working offline. The patch touches
 * `node_modules/prisma/build/cli.js` only, which is `.gitignore`'d — it
 * never reaches Git.
 */
import fs from "node:fs";
import path from "node:path";

const candidates = [
  "node_modules/prisma/build/cli.js",
  "node_modules/.pnpm/prisma@7.10.0/node_modules/prisma/build/cli.js",
];

function patchFile(file) {
  if (!fs.existsSync(file)) return false;
  const original = fs.readFileSync(file, "utf8");
  let patched = original;
  // The list is defined in `Tur()` as `KI.new(..., ["version","init","migrate","db","generate",...], A$, e)`
  // We want to keep only the commands that truly need a downloadable binary:
  // `migrate`/`db` (schema-engine) and `version` meta. `generate`/`validate`/`format` are WASM-only.
  const from = '["version","init","migrate","db","generate","validate","format","telemetry"]';
  const to = '["version","init","migrate","db","telemetry"]';
  if (patched.includes(from)) {
    patched = patched.replace(from, to);
  }
  // Some Prisma builds use a slightly different ordering; handle the shorter variant we produce after first patch:
  const from2 = '["version","init","migrate","db","validate","format","telemetry"]';
  if (patched.includes(from2)) {
    patched = patched.replace(from2, to);
  }
  if (patched !== original) {
    fs.writeFileSync(file, patched, "utf8");
    console.log(`[patch-prisma-cli] patched ${file}`);
    return true;
  }
  return false;
}

let didPatch = false;
for (const rel of candidates) {
  const abs = path.resolve(process.cwd(), rel);
  if (patchFile(abs)) didPatch = true;
}
// Also handle pnpm's content-addressed store: find any cli.js under node_modules/.pnpm
try {
  const pnpmRoot = path.resolve(process.cwd(), "node_modules/.pnpm");
  if (fs.existsSync(pnpmRoot)) {
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!entry.startsWith("prisma@")) continue;
      const p = path.join(pnpmRoot, entry, "node_modules/prisma/build/cli.js");
      if (patchFile(p)) didPatch = true;
    }
  }
} catch {}

if (!didPatch) {
  // Not an error: generate may still succeed if the CLI is already patched or network is available.
}
