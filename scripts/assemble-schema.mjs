#!/usr/bin/env node
/**
 * Assembles prisma/schema.prisma from the ordered part files in prisma/parts/.
 *
 * The schema is large (110+ models); keeping it split by domain makes review
 * practical while a single assembled file is what Prisma actually reads.
 *
 * Usage:
 *   node scripts/assemble-schema.mjs           # write prisma/schema.prisma
 *   node scripts/assemble-schema.mjs --check   # fail if the assembled file is stale
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PARTS_DIR = path.join(ROOT, "prisma", "parts");
const OUT = path.join(ROOT, "prisma", "schema.prisma");
const check = process.argv.includes("--check");

const parts = fs
  .readdirSync(PARTS_DIR)
  .filter((file) => file.endsWith(".prisma"))
  .sort();

if (parts.length === 0) {
  console.error(`No schema parts found in ${PARTS_DIR}`);
  process.exit(1);
}

const header = [
  "// AUTO-ASSEMBLED from prisma/parts/*.prisma — run `npm run db:assemble` after editing parts.",
  `// Parts (in order): ${parts.join(", ")}`,
  "",
].join("\n");

const body = parts
  .map((file) => fs.readFileSync(path.join(PARTS_DIR, file), "utf8").trimEnd())
  .join("\n\n");

const assembled = `${header}${body}\n`;

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== assembled) {
    console.error("prisma/schema.prisma is out of date — run `npm run db:assemble`.");
    process.exit(1);
  }
  console.log("prisma/schema.prisma is up to date with prisma/parts/");
} else {
  fs.writeFileSync(OUT, assembled);
  console.log(`Assembled ${parts.length} parts into prisma/schema.prisma (${assembled.split("\n").length} lines).`);
}
