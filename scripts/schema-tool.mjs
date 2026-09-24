#!/usr/bin/env node
/**
 * Schema tooling for the E-Store platform.
 *
 * The Prisma CLI requires downloadable native engine binaries for migration
 * commands. In restricted network environments (and for repeatable, reviewable
 * migration authoring) we generate the SQL ourselves from `prisma/schema.prisma`
 * and verify that the live database matches the schema.
 *
 * Usage:
 *   node scripts/schema-tool.mjs sql     [--out prisma/migrations/<ts>_init/migration.sql]
 *   node scripts/schema-tool.mjs check   [--database estore]
 *
 * The generated SQL follows Prisma's PostgreSQL conventions (identifiers quoted
 * exactly like the schema, `_fkey` constraint names, `_key`/`_idx` index names)
 * so that the same migration files can also be applied by `prisma migrate deploy`
 * on a machine that has the Prisma engines available.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SCHEMA_PATH = process.env.PRISMA_SCHEMA_PATH ?? "prisma/schema.prisma";

// ---------------------------------------------------------------------------
// Schema parsing
// ---------------------------------------------------------------------------

const SCALARS = new Set(["String", "Int", "BigInt", "Boolean", "DateTime", "Json", "Float", "Decimal", "Bytes"]);

function stripComments(source) {
  return source
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

function parseSchema(source) {
  const text = stripComments(source);
  const models = [];
  const enums = [];

  const blockRe = /(model|enum)\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const [, kind, name, body] = match;
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"));

    if (kind === "enum") {
      enums.push({ name, values: lines.filter((l) => /^\w+$/.test(l)) });
      continue;
    }

    const model = { name, fields: [], attributes: [], indexes: [] };
    for (const line of lines) {
      if (line.startsWith("@@")) {
        model.attributes.push(line);
        continue;
      }
      const fieldMatch = line.match(/^(\w+)\s+([\w[\]?]+)(.*)$/);
      if (!fieldMatch) continue;
      const [, fieldName, fieldType, rest] = fieldMatch;
      const attributes = [...rest.matchAll(/@\w+(\((?:[^()]|\([^()]*\))*\))?/g)].map((m) => m[0]);

      const isList = fieldType.endsWith("[]");
      const optional = fieldType.endsWith("?");
      const typeName = fieldType.replace(/[?[\]]/g, "");

      const relationAttr = attributes.find((a) => a.startsWith("@relation"));
      const defaultAttr = attributes.find((a) => a.startsWith("@default"));
      const attrArg = (attr, key) => {
        if (!attr) return null;
        const m = attr.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`));
        return m ? m[1].split(",").map((v) => v.trim()).filter(Boolean) : null;
      };
      const attrScalar = (attr, key) => {
        if (!attr) return null;
        const m = attr.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
        return m ? m[1] : null;
      };

      model.fields.push({
        name: fieldName,
        type: typeName,
        isList,
        optional,
        isScalar: SCALARS.has(typeName),
        isEnum: enums.some((e) => e.name === typeName) || /^[A-Z]/.test(typeName) === false ? false : null,
        attributes,
        isId: attributes.includes("@id"),
        isUnique: attributes.includes("@unique"),
        default: defaultAttr ? defaultAttr.replace(/^@default\((.*)\)$/, "$1") : null,
        relation: relationAttr
          ? {
              name: attrScalar(relationAttr, "name") ?? attrScalar(relationAttr, "map"),
              fields: attrArg(relationAttr, "fields") ?? [],
              references: attrArg(relationAttr, "references") ?? [],
              onDelete: attrScalar(relationAttr, "onDelete") ?? "SetNull",
              onUpdate: attrScalar(relationAttr, "onUpdate") ?? "Cascade",
            }
          : null,
      });
    }
    models.push(model);
  }

  // Second pass: resolve which type names are enums.
  const enumNames = new Set(enums.map((e) => e.name));
  for (const model of models) {
    for (const field of model.fields) {
      field.isEnum = enumNames.has(field.type);
    }
  }

  return { models, enums };
}

// ---------------------------------------------------------------------------
// SQL generation (Prisma PostgreSQL conventions)
// ---------------------------------------------------------------------------

function mapScalar(field) {
  if (field.isEnum) return `"${field.type}"`;
  switch (field.type) {
    case "String":
      return "TEXT";
    case "Int":
      return "INTEGER";
    case "BigInt":
      return "BIGINT";
    case "Boolean":
      return "BOOLEAN";
    case "DateTime":
      return "TIMESTAMP(3)";
    case "Json":
      return "JSONB";
    case "Float":
      return "DOUBLE PRECISION";
    case "Decimal":
      return "DECIMAL(65,30)";
    case "Bytes":
      return "BYTEA";
    default:
      return "TEXT";
  }
}

function mapDefault(field) {
  if (!field.default) return null;
  const value = field.default;
  if (value === "now()") return "CURRENT_TIMESTAMP";
  if (value === "uuid()" || value === "cuid()") return "gen_random_uuid()";
  if (value === "autoincrement()") return null;
  if (value === "true" || value === "false") return value;
  if (/^-?\d+$/.test(value)) return value;
  if (/^dbgenerated\(/.test(value)) return value.replace(/^dbgenerated\("(.*)"\)$/, "$1");
  if (/^"[^"]*"$/.test(value)) return `${value.replace(/"/g, "'")}`;
  // enum value
  return `'${value}'`;
}

function constraintSuffix(fields) {
  if (fields.length === 1) return fields[0];
  return fields.join("_");
}

function generateSql(schema) {
  const lines = [];
  const enumStatements = [];

  for (const enumType of schema.enums) {
    enumStatements.push(
      `-- CreateEnum\nCREATE TYPE "${enumType.name}" AS ENUM (${enumType.values.map((v) => `'${v}'`).join(", ")});`,
    );
  }

  const tables = [];
  const foreignKeys = [];
  const indexes = [];

  for (const model of schema.models) {
    const columns = [];
    const modelIndexes = [];
    const modelFks = [];

    const idFields = model.fields.filter((f) => f.isId && f.isScalar);
    const primaryKeyFields = idFields.map((f) => f.name);

    for (const field of model.fields) {
      if (!field.isScalar && !field.isEnum) continue; // relation virtual field
      if (field.isList && field.isScalar) continue; // String[] handled separately below
      const columnName = field.name;
      const sqlType = mapScalar(field);
      const parts = [`"${columnName}" ${sqlType}`];
      const defaultSql = mapDefault(field);
      if (field.type === "String" && field.isList) {
        // PostgreSQL array column
        parts[0] = `"${columnName}" TEXT[]`;
        if (defaultSql) parts.push(`DEFAULT ${defaultSql}`);
        if (field.optional) parts.push("DEFAULT ARRAY[]::TEXT[]");
        columns.push(parts.join(" "));
        continue;
      }
      if (defaultSql && !field.isList) parts.push(`DEFAULT ${defaultSql}`);
      if (!field.optional) parts.push("NOT NULL");
      columns.push(parts.join(" "));
    }

    // String[] list fields become TEXT[] columns.
    for (const field of model.fields) {
      if (field.isList && field.type === "String") {
        if (!columns.some((c) => c.startsWith(`"${field.name}"`))) {
          columns.push(`"${field.name}" TEXT[]${field.optional ? "" : " NOT NULL DEFAULT ARRAY[]::TEXT[]"}`);
        }
      }
    }

    if (primaryKeyFields.length === 1) {
      columns.push(`CONSTRAINT "${model.name}_pkey" PRIMARY KEY ("${primaryKeyFields[0]}")`);
    } else if (primaryKeyFields.length > 1) {
      columns.push(
        `CONSTRAINT "${model.name}_pkey" PRIMARY KEY (${primaryKeyFields.map((f) => `"${f}"`).join(", ")})`,
      );
    }

    for (const field of model.fields) {
      if (field.isUnique && !field.isId) {
        modelIndexes.push(`CREATE UNIQUE INDEX "${model.name}_${field.name}_key" ON "${model.name}"("${field.name}");`);
      }
      if (field.relation && field.relation.fields.length > 0) {
        const fkName = `${model.name}_${constraintSuffix(field.relation.fields)}_fkey`;
        const referentialAction = (action) =>
          ({ Cascade: "CASCADE", Restrict: "RESTRICT", NoAction: "NO ACTION", SetNull: "SET NULL", SetDefault: "SET DEFAULT" })[action] ??
          "NO ACTION";
        modelFks.push(
          `ALTER TABLE "${model.name}" ADD CONSTRAINT "${fkName}" FOREIGN KEY (${field.relation.fields
            .map((f) => `"${f}"`)
            .join(", ")}) REFERENCES "${referencedModelOf(schema, field) ?? "?"}"(${field.relation.references
            .map((f) => `"${f}"`)
            .join(", ")}) ON DELETE ${referentialAction(field.relation.onDelete)} ON UPDATE ${referentialAction(field.relation.onUpdate)};`,
        );
      }
    }

    for (const attribute of model.attributes) {
      const uniqueMatch = attribute.match(/^@@unique\(\[([^\]]*)\](?:\s*,\s*name:\s*"([^"]*)")?/);
      if (uniqueMatch) {
        const fields = uniqueMatch[1].split(",").map((f) => f.trim()).filter(Boolean);
        const name = uniqueMatch[2] ?? `${model.name}_${constraintSuffix(fields)}_key`;
        modelIndexes.push(
          `CREATE UNIQUE INDEX "${name}" ON "${model.name}"(${fields.map((f) => `"${f}"`).join(", ")});`,
        );
        continue;
      }
      const indexMatch = attribute.match(/^@@index\(\[([^\]]*)\](?:\s*,\s*name:\s*"([^"]*)")?/);
      if (indexMatch) {
        const fields = indexMatch[1]
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
          .map((f) => (f.endsWith("desc") || f.endsWith("asc") ? f : `"${f}"`));
        const name = indexMatch[2] ?? `${model.name}_${constraintSuffix(fields.map((f) => f.replace(/"/g, "")))}_idx`;
        modelIndexes.push(`CREATE INDEX "${name}" ON "${model.name}"(${fields.join(", ")});`);
      }
    }

    tables.push({
      name: model.name,
      sql: `-- CreateTable\nCREATE TABLE "${model.name}" (\n${columns.map((c) => `    ${c}`).join(",\n")}\n);`,
    });
    indexes.push(...modelIndexes.map((i) => `-- CreateIndex\n${i}`));
    foreignKeys.push(...modelFks.map((f) => `-- AddForeignKey\n${f}`));
  }

  lines.push(...enumStatements.map((s) => `${s}\n`));
  for (const table of tables) lines.push(`${table.sql}\n`);
  for (const index of indexes) lines.push(`${index}\n`);
  for (const fk of foreignKeys) lines.push(`${fk}\n`);

  return lines.join("\n");
}

/** Find the model referenced by a relation field (Prisma relation target). */
function referencedModelOf(schema, field) {
  const typeName = field.relation.references && field.relation.references.length ? null : null;
  const target = field.type;
  return schema.models.some((m) => m.name === target) ? target : null;
}

// ---------------------------------------------------------------------------
// Drift check: compare schema to a live database
// ---------------------------------------------------------------------------

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
      /* next */
    }
  }
  throw new Error("pg client library not found");
}

async function check(schema, databaseUrl) {
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const problems = [];
  try {
    const { rows: tableRows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const dbTables = new Set(tableRows.map((r) => r.table_name));
    const schemaTables = new Set(schema.models.map((m) => m.name));

    for (const model of schema.models) {
      if (!dbTables.has(model.name)) {
        problems.push(`missing table: ${model.name}`);
        continue;
      }
      const { rows: columnRows } = await client.query(
        `SELECT column_name, is_nullable, data_type, udt_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [model.name],
      );
      const dbColumns = new Map(columnRows.map((r) => [r.column_name, r]));
      for (const field of model.fields) {
        if ((!field.isScalar && !field.isEnum) || field.isList) continue;
        const column = dbColumns.get(field.name);
        if (!column) {
          problems.push(`missing column: ${model.name}.${field.name}`);
          continue;
        }
        if (!field.optional && column.is_nullable === "YES") {
          problems.push(`column should be NOT NULL: ${model.name}.${field.name}`);
        }
        if (field.isEnum && column.udt_name !== field.type) {
          problems.push(`enum type mismatch: ${model.name}.${field.name} expected ${field.type}, found ${column.udt_name}`);
        }
      }
      for (const columnName of dbColumns.keys()) {
        if (!model.fields.some((f) => f.name === columnName)) {
          problems.push(`extra column in database: ${model.name}.${columnName}`);
        }
      }
    }
    for (const table of dbTables) {
      if (table !== "_prisma_migrations" && !schemaTables.has(table)) {
        problems.push(`extra table in database: ${table}`);
      }
    }

    const { rows: enumRows } = await client.query(
      `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`,
    );
    const dbEnums = new Map(enumRows.map((r) => [r.typname, String(r.labels ?? "").split(",").filter(Boolean)]));
    for (const enumType of schema.enums) {
      const labels = dbEnums.get(enumType.name);
      if (!labels) {
        problems.push(`missing enum type: ${enumType.name}`);
        continue;
      }
      // PostgreSQL appends values added later with `ALTER TYPE ... ADD VALUE`, so
      // the physical order carries no meaning: compare the sets and report only
      // labels that are genuinely missing or unexpected.
      const missing = enumType.values.filter((value) => !labels.includes(value));
      const extra = labels.filter((value) => !enumType.values.includes(value));
      if (missing.length > 0 || extra.length > 0) {
        problems.push(
          `enum values differ: ${enumType.name} (missing: ${missing.join(", ") || "none"}; extra in db: ${extra.join(", ") || "none"})`,
        );
      }
    }
  } finally {
    await client.end();
  }
  return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [, , command, ...rest] = process.argv;
const argValue = (flag) => {
  const index = rest.indexOf(flag);
  return index === -1 ? null : rest[index + 1];
};

if (command === "sql") {
  const schema = parseSchema(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const parts = [generateSql(schema)];
  const extraFile = "prisma/migrations/extra-constraints.sql";
  if (fs.existsSync(extraFile)) {
    parts.push("\n-- Extra constraints and indexes maintained by the team\n");
    parts.push(fs.readFileSync(extraFile, "utf8"));
  }
  const sql = parts.join("\n");
  const out = argValue("--out");
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${sql}\n`);
    console.log(`Wrote ${sql.split("\n").length} lines to ${out}`);
    console.log(
      `Checksum: ${crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16)}`,
    );
  } else {
    process.stdout.write(sql);
  }
} else if (command === "check") {
  const schema = parseSchema(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const databaseUrl =
    argValue("--url") ??
    process.env.DATABASE_URL ??
    `postgresql://postgres@127.0.0.1:5432/${argValue("--database") ?? "estore"}`;
  const problems = await check(schema, databaseUrl);
  if (problems.length === 0) {
    console.log("OK: database matches prisma/schema.prisma");
  } else {
    console.log(`Drift detected (${problems.length}):`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  }
} else {
  console.error("Usage: schema-tool.mjs <sql|check> [--out file] [--url connection-string]");
  process.exit(1);
}
