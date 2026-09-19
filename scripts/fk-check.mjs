#!/usr/bin/env node
/**
 * Foreign-key referential-action checker.
 *
 * The SQL migrations in this repository are authored by hand (the Prisma schema
 * engine cannot be downloaded in this environment), so nothing guarantees that
 * the ON DELETE behaviour in PostgreSQL matches the `onDelete` declared in
 * `prisma/schema.prisma`. A mismatch is not cosmetic: `ON DELETE SET NULL` on a
 * NOT NULL column makes a legitimate parent delete fail with a null-constraint
 * error, and a missing CASCADE silently orphans child rows.
 *
 * Usage: node scripts/fk-check.mjs [--json]
 * Exit code 1 when drift is found.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "pg";
import "dotenv/config";

const CONFLICT_ACTIONS = {
  a: "NoAction",
  r: "Restrict",
  c: "Cascade",
  n: "SetNull",
  d: "SetDefault",
};

const MODEL_RE = /^model\s+(\w+)\s*\{/;
const FIELD_RE = /^\s*(?:\/\/\/.*\n\s*)?(\w+)\s+([\w[\]?]+)\s+(.*)$/;
const RELATION_RE = /@relation\(([^)]*)\)/;
const FIELDS_RE = /fields:\s*\[([^\]]*)\]/;
const REFERENCES_RE = /references:\s*\[([^\]]*)\]/;
const ONDELETE_RE = /onDelete:\s*(\w+)/;

export function parseSchema(schemaText) {
  const lines = schemaText.split("\n");
  const relations = [];
  let model = null;
  let pendingDoc = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("///")) {
      pendingDoc = line.replace(/^\/\/\/\s?/, "");
      continue;
    }

    const modelMatch = MODEL_RE.exec(line);
    if (modelMatch) {
      model = modelMatch[1];
      pendingDoc = null;
      continue;
    }
    if (line === "}") {
      model = null;
      pendingDoc = null;
      continue;
    }
    if (!model || line.startsWith("//") || line.startsWith("@")) continue;

    const fieldMatch = FIELD_RE.exec(rawLine);
    const relationMatch = RELATION_RE.exec(line);
    if (!fieldMatch || !relationMatch) continue;

    const [, fieldName, fieldType] = fieldMatch;
    const args = relationMatch[1];
    const fields = FIELDS_RE.exec(args);
    if (!fields) continue; // the relation is owned by the other side

    const references = REFERENCES_RE.exec(args);
    const onDelete = ONDELETE_RE.exec(args);
    const columns = fields[1].split(",").map((value) => value.trim()).filter(Boolean);
    const referencedColumns = references
      ? references[1].split(",").map((value) => value.trim()).filter(Boolean)
      : ["id"];

    // Prisma's defaults: required relations RESTRICT on delete, optional SET NULL.
    const isOptional = fieldType.endsWith("?");
    const expected = onDelete ? onDelete[1] : isOptional ? "SetNull" : "Restrict";

    relations.push({
      model,
      field: fieldName,
      columns,
      referencedColumns,
      expected,
      declared: Boolean(onDelete),
      doc: pendingDoc,
    });
    pendingDoc = null;
  }

  return relations;
}

async function fetchConstraints(client) {
  const result = await client.query(`
    SELECT c.conname AS name,
           t.relname AS table,
           a.attname AS column,
           ft.relname AS referenced_table,
           fa.attname AS referenced_column,
           c.confdeltype AS on_delete,
           c.confupdtype AS on_update,
           k.ord
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
    JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
    WHERE c.contype = 'f'
      AND t.relnamespace = 'public'::regnamespace
    ORDER BY t.relname, c.conname, k.ord`);
  return result.rows;
}

/** Groups rows of pg_constraint (one per column) into constraints. */
function groupConstraints(rows) {
  const map = new Map();
  for (const row of rows) {
    const existing = map.get(row.name) ?? {
      name: row.name,
      table: row.table,
      columns: [],
      referencedTable: row.referenced_table,
      referencedColumns: [],
      onDelete: CONFLICT_ACTIONS[row.on_delete],
      onDeleteCode: row.on_delete,
      onUpdate: CONFLICT_ACTIONS[row.on_update],
    };
    existing.columns.push(row.column);
    existing.referencedColumns.push(row.referenced_column);
    map.set(row.name, existing);
  }
  return [...map.values()];
}

async function main() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const relations = parseSchema(schema);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const constraintRows = await fetchConstraints(client);
  await client.end();

  const constraints = groupConstraints(constraintRows);
  const byTableColumn = new Map();
  for (const constraint of constraints) {
    constraint.columns.forEach((column, index) => {
      byTableColumn.set(`${constraint.table}.${column}`, { ...constraint, column, referenced_column: constraint.referencedColumns[index] });
    });
  }

  const problems = [];
  const matchedConstraints = new Set();

  for (const relation of relations) {
    relation.columns.forEach((column, index) => {
      const key = `${relation.model}.${column}`;
      const constraint = byTableColumn.get(key);
      if (!constraint) {
        problems.push({
          type: "missing",
          key,
          expected: relation.expected,
          detail: `${relation.model}.${column} → ${relation.field} (${relation.referencedColumns[index] ?? "id"})`,
        });
        return;
      }
      matchedConstraints.add(constraint.name);
      const actual = constraint.onDelete;
      if (actual !== relation.expected) {
        problems.push({
          type: "mismatch",
          key,
          constraint: constraint.name,
          expected: relation.expected,
          actual,
          table: constraint.table,
          columns: [column],
          referencedTable: constraint.referencedTable,
          referencedColumns: [constraint.referenced_column],
          detail: `${relation.model}.${column} (${relation.field})`,
        });
      }
    });
  }

  for (const constraint of constraints) {
    if (!matchedConstraints.has(constraint.name)) {
      problems.push({
        type: "unknown",
        key: `${constraint.table}.${constraint.columns.join(",")}`,
        constraint: constraint.name,
        table: constraint.table,
        columns: constraint.columns,
        referencedTable: constraint.referencedTable,
        referencedColumns: constraint.referencedColumns,
        detail: `constraint exists in the database but is not declared in prisma/schema.prisma (${constraint.onDelete})`,
      });
    }
  }

  const fixIndex = process.argv.indexOf("--emit-fix");
  if (fixIndex !== -1) {
    const target = process.argv[fixIndex + 1];
    const toSqlAction = (action) => `ON DELETE ${action.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()}`;
    const statements = problems
      .filter((problem) => problem.type === "mismatch" || problem.type === "unknown")
      .map((problem) => {
        const columns = problem.columns.map((column) => `"${column}"`).join(", ");
        const referenced = problem.referencedColumns.map((column) => `"${column}"`).join(", ");
        return [
          `ALTER TABLE "${problem.table}" DROP CONSTRAINT "${problem.constraint}";`,
          `ALTER TABLE "${problem.table}" ADD CONSTRAINT "${problem.constraint}" FOREIGN KEY (${columns}) REFERENCES "${problem.referencedTable}" (${referenced}) ${toSqlAction(problem.expected ?? "Restrict")} ON UPDATE CASCADE;`,
        ].join("\n");
      });

    const header = [
      "-- Generated by scripts/fk-check.mjs --emit-fix.",
      "--",
      "-- The initial migration created every foreign key with ON DELETE SET NULL, which",
      "-- contradicts the referential actions declared in prisma/schema.prisma (and makes",
      "-- deleting a parent fail outright when the column is NOT NULL). This migration",
      "-- restores the declared behaviour for each affected constraint.",
      "",
    ].join("\n");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${header}${statements.join("\n\n")}\n`);
    console.log(`Wrote ${statements.length} constraint fix(es) to ${target}`);
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(problems, null, 2));
  } else if (problems.length === 0) {
    console.log(`Foreign keys OK: ${constraints.length} constraints match prisma/schema.prisma`);
  } else {
    console.error(`Foreign-key drift: ${problems.length} problem(s)\n`);
    for (const problem of problems) {
      console.error(`  [${problem.type}] ${problem.detail}`);
      if (problem.constraint) console.error(`      constraint: ${problem.constraint}`);
      if (problem.expected || problem.actual) {
        console.error(`      declared: ${problem.expected ?? "-"}  database: ${problem.actual ?? "-"}`);
      }
    }
  }

  process.exit(problems.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
