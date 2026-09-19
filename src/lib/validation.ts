import { z } from "zod";
import { AppError } from "@/lib/errors";
import { normalizeBdPhone } from "@/lib/utils";

/**
 * Shared validation primitives and conventions.
 *
 * Every server entry point validates input with Zod before touching the
 * database. `parseInput` throws a structured AppError so API routes and server
 * actions return consistent, safe error messages.
 */

export const zId = z.string().min(1).max(64);
export const zUuidLike = z.string().min(8).max(64);

export const zSlug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower case letters, numbers and dashes only");

/**
 * Optional slug for HTML forms: an empty field means "generate it from the
 * name", so a blank submission becomes `undefined` rather than failing the
 * `min(1)` rule on `zSlug`. Non-empty values still have to be valid slugs.
 * The trailing `.optional()` keeps the key optional in inferred object types.
 */
export const zOptionalSlug = z
  .union([z.literal(""), zSlug])
  .transform((value) => (value === "" ? undefined : value))
  .optional();

export const zPhoneBd = z
  .string()
  .min(6)
  .max(24)
  .transform((value, ctx) => {
    const normalized = normalizeBdPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Bangladeshi mobile number (e.g. 01712345678)" });
      return z.NEVER;
    }
    return normalized;
  });

export const zEmail = z.string().trim().toLowerCase().email().max(200);

export const zOptionalEmail = z
  .union([z.literal(""), zEmail])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const zOptimisticTimestamp = z.coerce.date().optional();

export const zMoneyPaisa = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const zSignedMoneyPaisa = z.coerce.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const zPositiveMoneyPaisa = z.coerce.number().int().positive();
export const zQuantity = z.coerce.number().int().positive().max(100_000);
export const zNonNegativeQuantity = z.coerce.number().int().min(0).max(1_000_000);

export const zSortDirection = z.enum(["asc", "desc"]).default("desc");

export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof zPagination>;

export const zDateRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export interface ParsedListQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search?: string;
  sortBy?: string;
  sortDir: "asc" | "desc";
}

/** Parse pagination/search/sort parameters from a URLSearchParams or object. */
export function parseListQuery(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  options: {
    defaultSortBy?: string;
    defaultSortDir?: "asc" | "desc";
    maxPageSize?: number;
    /** Columns a client is allowed to sort by. Anything else falls back to the default. */
    allowedSortBy?: readonly string[];
  } = {},
): ParsedListQuery {
  const get = (key: string): string | undefined => {
    if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
    const value = input[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Math.max(1, Number.parseInt(get("page") ?? "1", 10) || 1);
  const maxPageSize = options.maxPageSize ?? 100;
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(get("pageSize") ?? "20", 10) || 20));
  const sortDir = get("sortDir") === "asc" ? "asc" : options.defaultSortDir ?? "desc";
  // A client may only sort by columns the caller explicitly allows; without an
  // allowlist the requested column is ignored entirely so that an arbitrary
  // string can never reach the database as a column name.
  const requestedSort = get("sortBy");
  const allowed = options.allowedSortBy;
  const sortBy =
    requestedSort && allowed && allowed.includes(requestedSort) ? requestedSort : options.defaultSortBy;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    search: get("q")?.trim() || undefined,
    sortBy,
    sortDir,
  };
}

/**
 * Validate input and throw a structured error on failure.
 * The returned value is fully typed and safe to use.
 */
export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw AppError.validation(context ? `${context}: invalid input` : "The submitted data is invalid", details);
  }
  return result.data;
}

/** Build a Zod object from FormData values (server actions). */
export function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      const existing = result[key];
      if (existing === undefined) result[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else result[key] = [existing, value];
    }
  }
  return result;
}

export const zBooleanFromForm = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("1"), z.literal("0"), z.literal("")])
  .transform((value) => value === true || value === "true" || value === "on" || value === "1");

/**
 * Optional trimmed text where an empty form field becomes `undefined`.
 * The `.optional()` sits last on purpose so the key itself is optional in the
 * inferred object type, which keeps service input types ergonomic.
 */
export function zOptionalText(max = 2000) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();
}

export const zOptionalString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const zNote = z.string().trim().min(3).max(1000);
