/**
 * Product draft helpers — the pure half of the Create/Edit Product flow.
 *
 * Everything in this file is deterministic and side-effect free, so the same
 * functions drive the browser (live previews, counts, availability hints) and the
 * server (validation before writing). That is deliberate: a slug is suggested by
 * exactly the code that stores it, and the variant matrix the merchandiser sees is
 * the matrix the backend persists.
 */

import { resolveImage as resolveImageShared } from "@/modules/catalog/inheritance";

/* -------------------------------------------------------------------------- */
/* Slugs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * URL-friendly slug.
 *
 * - normalises to NFKD and drops combining marks, so `Café` → `cafe`;
 * - collapses every run of punctuation/whitespace into a single `-`;
 * - trims leading/trailing separators and caps the length on a separator
 *   boundary, so no word is cut in half;
 * - returns `""` when nothing usable is left (e.g. a name written entirely in a
 *   script without a Latin fallback) — the caller asks for a slug instead of
 *   silently generating an empty one.
 */
export function suggestSlug(value: string, maxLength = 80): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`"]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= maxLength) return slug;

  const truncated = slug.slice(0, maxLength);
  const lastSeparator = truncated.lastIndexOf("-");
  return (lastSeparator > maxLength * 0.5 ? truncated.slice(0, lastSeparator) : truncated).replace(/-+$/g, "");
}

/** A slug is only valid when it is non-empty, lower-case and separator-safe. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Append `-2`, `-3`, … until the candidate is free. Used to *suggest*, never to save. */
export function nextAvailableSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = desired || "item";
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix <= 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Weight                                                                     */
/* -------------------------------------------------------------------------- */

export const WEIGHT_UNITS = [
  { value: "g", label: "Gram (g)", grams: 1 },
  { value: "kg", label: "Kilogram (kg)", grams: 1_000 },
  { value: "lb", label: "Pound (lb)", grams: 453.59237 },
] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number]["value"];

export const DEFAULT_WEIGHT_UNIT: WeightUnit = "g";

export function isWeightUnit(value: unknown): value is WeightUnit {
  return WEIGHT_UNITS.some((unit) => unit.value === value);
}

export function weightUnitLabel(unit: WeightUnit): string {
  return WEIGHT_UNITS.find((entry) => entry.value === unit)?.label ?? unit;
}

/**
 * Convert a typed value to the gram integer the schema stores.
 *
 * Returns `null` for blank input and throws nothing: invalid values (NaN, Infinity,
 * negative, absurd) are reported by the schema, and a `null` never silently becomes
 * a wrong number in a different unit.
 */
export function toWeightGrams(value: string | number | null | undefined, unit: WeightUnit): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const factor = WEIGHT_UNITS.find((entry) => entry.value === unit)?.grams ?? 1;
  return Math.round(parsed * factor);
}

/** Best-effort display conversion: grams → the requested unit, trimmed of noise. */
export function fromWeightGrams(grams: number | null | undefined, unit: WeightUnit): string {
  if (grams === null || grams === undefined) return "";
  const factor = WEIGHT_UNITS.find((entry) => entry.value === unit)?.grams ?? 1;
  const value = grams / factor;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/* -------------------------------------------------------------------------- */
/* Variant matrix                                                             */
/* -------------------------------------------------------------------------- */

export interface DraftAttributeValue {
  id: string;
  value: string;
  colorHex?: string | null;
  /** Default image for this value (attribute-value level inheritance). */
  mediaId?: string | null;
  /** Attribute-level pricing override (precedence: variant > attribute > product). */
  priceOverridePaisa?: number | null;
  currentPricePaisa?: number | null;
  discountType?: DiscountType;
  discountValue?: number | null;
}

export interface DraftAttribute {
  id: string;
  name: string;
  slug: string;
  type?: string;
  isVariantDefining?: boolean;
  values: DraftAttributeValue[];
}

export interface DraftVariant {
  /** Stable client key; the persisted variant id once it exists. */
  key: string;
  /** Persisted variant id. This — not a SKU — is the variant's identity. */
  id?: string;
  name: string;
  barcode?: string;
  /** Level-1 pricing override. Empty means "inherit the attribute/product price". */
  currentPrice?: string;
  discountType?: DiscountType;
  discountValue?: string;
  /** Explicit sell price (derived from current price + discount when empty). */
  price?: string;
  compareAt?: string;
  cost?: string;
  weight?: string;
  weightUnit?: WeightUnit;
  isPreorderEnabled?: boolean;
  packagingCost?: string;
  /** Variant-level image override; `null` means "inherit". */
  imageMediaId: string | null;
  galleryMediaIds: string[];
  /** Ordered attribute value ids — the combination this variant represents. */
  attributeValueIds: string[];
  /** True once a person edited any field by hand. */
  touched?: boolean;
  clearPriceOverride?: boolean;
  clearCostOverride?: boolean;
  clearWeightOverride?: boolean;
  clearPreorderOverride?: boolean;
  clearImageOverride?: boolean;
  clearPackagingCostOverride?: boolean;
}

/** Deterministic key of a combination, independent of the order values were picked in. */
export function combinationKey(attributeValueIds: string[]): string {
  return [...attributeValueIds].filter(Boolean).sort().join("|");
}

/** Cartesian product of the selected values of the variation attributes. */
export function buildCombinations(attributes: DraftAttribute[], selectedValueIds: string[]): string[][] {
  const relevant = attributes
    .filter((attribute) => attribute.isVariantDefining !== false)
    .map((attribute) => ({
      attribute,
      values: attribute.values.filter((value) => selectedValueIds.includes(value.id)),
    }))
    .filter((entry) => entry.values.length > 0);

  if (relevant.length === 0) return [];

  return relevant.reduce<string[][]>(
    (combinations, entry) => combinations.flatMap((combination) => entry.values.map((value) => [...combination, value.id])),
    [[]],
  );
}

export function variantLabel(attributes: DraftAttribute[], attributeValueIds: string[]): string {
  return attributeValueIds
    .map((valueId) => {
      for (const attribute of attributes) {
        const value = attribute.values.find((entry) => entry.id === valueId);
        if (value) return value.value;
      }
      return "";
    })
    .filter(Boolean)
    .join(" / ");
}

export type DiscountType = "PERCENTAGE" | "FLAT" | "NONE";

export interface MatrixPlan {
  /** Rows that already exist and still belong to the matrix. */
  kept: DraftVariant[];
  /** Rows the matrix adds. */
  added: DraftVariant[];
  /** Existing rows that are no longer part of the matrix, kept so no data is lost. */
  orphans: DraftVariant[];
  /** Final ordering: kept + added (orphans are appended by the caller if it keeps them). */
  rows: DraftVariant[];
  combinations: number;
}

/**
 * Plan a regeneration without destroying anything.
 *
 * - A combination that already has a row keeps that row (and every value typed
 *   into it: SKU, price, images, overrides).
 * - A new combination becomes a row.
 * - A row whose combination is no longer selected is returned as an **orphan**
 *   rather than deleted, so a merchandiser who unticks a value by accident does
 *   not lose the SKU and price they already filled in. The UI lists those rows and
 *   asks explicitly before removing them.
 */
export function planMatrix(
  attributes: DraftAttribute[],
  selectedValueIds: string[],
  existing: DraftVariant[],
  options: { skuPrefix?: string; keepOrphans?: boolean } = {},
): MatrixPlan {
  const combinations = buildCombinations(attributes, selectedValueIds);
  const existingByKey = new Map(existing.map((row) => [combinationKey(row.attributeValueIds), row]));
  const seen = new Set<string>();

  const kept: DraftVariant[] = [];
  const added: DraftVariant[] = [];

  combinations.forEach((combination, index) => {
    const key = combinationKey(combination);
    if (seen.has(key)) return;
    seen.add(key);
    const existingRow = existingByKey.get(key);
    if (existingRow) {
      kept.push({ ...existingRow, attributeValueIds: combination, name: existingRow.name || variantLabel(attributes, combination) });
      return;
    }
    added.push({
      key: `new-${key}-${index}`,
      name: variantLabel(attributes, combination),
      currentPrice: "",
      discountType: "NONE",
      discountValue: "",
      price: "",
      compareAt: "",
      cost: "",
      weight: "",
      weightUnit: DEFAULT_WEIGHT_UNIT,
      isPreorderEnabled: undefined,
      packagingCost: "",
      imageMediaId: null,
      galleryMediaIds: [],
      attributeValueIds: combination,
    });
  });

  const orphans = existing.filter((row) => !seen.has(combinationKey(row.attributeValueIds)));

  return {
    kept,
    added,
    orphans,
    rows: options.keepOrphans === false ? [...kept, ...added] : [...kept, ...added, ...orphans],
    combinations: combinations.length,
  };
}

/**
 * Clear a specific override on a variant, restoring inheritance from attribute or product default.
 */
export function clearVariantPropertyOverride(
  variant: DraftVariant,
  property: "price" | "cost" | "weight" | "preorder" | "image" | "packagingCost",
): DraftVariant {
  switch (property) {
    case "price":
      return {
        ...variant,
        price: "",
        compareAt: "",
        currentPrice: "",
        discountValue: "",
        discountType: "NONE",
        clearPriceOverride: true,
      };
    case "cost":
      return { ...variant, cost: "", clearCostOverride: true };
    case "weight":
      return { ...variant, weight: "", clearWeightOverride: true };
    case "preorder":
      return { ...variant, isPreorderEnabled: undefined, clearPreorderOverride: true };
    case "image":
      return { ...variant, imageMediaId: null, clearImageOverride: true };
    case "packagingCost":
      return { ...variant, packagingCost: "", clearPackagingCostOverride: true };
    default:
      return variant;
  }
}

/* -------------------------------------------------------------------------- */
/* Image inheritance                                                          */
/* -------------------------------------------------------------------------- */

export type ImageSourceKind = "variant" | "attribute" | "product" | "none";

export interface ResolvedImage {
  mediaId: string | null;
  kind: ImageSourceKind;
  /** Human label used by the table, the picker and the API ("Inherited from Color: Black"). */
  label: string;
  attributeValueId?: string;
  attributeName?: string;
  attributeValue?: string;
}

/**
 * Precedence: variant override → attribute-value default → product image → none.
 *
 * Thin wrapper around the shared resolver (`modules/catalog/inheritance.ts`) so
 * the editor, the storefront and the API can never disagree about which image a
 * variant shows.
 */
export function resolveVariantImage(input: {
  imageMediaId?: string | null;
  attributeValueIds: string[];
  productImageMediaId: string | null;
  attributes: DraftAttribute[];
}): ResolvedImage {
  const resolved = resolveImageShared({
    variantImageMediaId: input.imageMediaId ?? null,
    attributeValues: input.attributes.flatMap((attribute) =>
      attribute.values
        .filter((value) => input.attributeValueIds.includes(value.id))
        .map((value) => ({
          attributeValueId: value.id,
          attributeName: attribute.name,
          valueLabel: value.value,
          value: value.mediaId ?? null,
        })),
    ),
    productImageMediaId: input.productImageMediaId,
  });

  return {
    mediaId: resolved.mediaId,
    kind: resolved.level === "VARIANT" ? "variant" : resolved.level === "ATTRIBUTE" ? "attribute" : resolved.level === "PRODUCT" ? "product" : "none",
    label: resolved.label,
    ...(resolved.attributeValueId ? { attributeValueId: resolved.attributeValueId } : {}),
    ...(resolved.attributeName ? { attributeName: resolved.attributeName } : {}),
    ...(resolved.attributeValueLabel ? { attributeValue: resolved.attributeValueLabel } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Bulk actions                                                              */
/* -------------------------------------------------------------------------- */

export type BulkTargetKind = "all" | "selected" | "attribute";

export interface BulkTargetCriteria {
  /** One entry per attribute the action should match ("Color is Black"). */
  attributeId: string;
  /** Values of that attribute the variant may carry; matching any one is enough. */
  valueIds: string[];
}

export interface BulkTarget {
  kind: BulkTargetKind;
  variantIds?: string[];
  criteria?: BulkTargetCriteria[];
}

export function describeBulkTarget(
  target: BulkTarget,
  context: { attributes: DraftAttribute[]; selectedCount: number; totalCount: number },
): string {
  if (target.kind === "all") return `All ${context.totalCount} variant(s)`;
  if (target.kind === "selected") return `${context.selectedCount} selected variant(s)`;
  const parts = (target.criteria ?? [])
    .map((criterion) => {
      const attribute = context.attributes.find((entry) => entry.id === criterion.attributeId);
      if (!attribute) return null;
      const values = criterion.valueIds
        .map((valueId) => attribute.values.find((value) => value.id === valueId)?.value)
        .filter((value): value is string => Boolean(value));
      return values.length > 0 ? `${attribute.name} = ${values.join(" or ")}` : null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `Variants where ${parts.join(" and ")}` : "No variants match the current filter";
}

/** Resolve which variant rows an action applies to. */
export function resolveBulkTarget(
  target: BulkTarget,
  context: { rows: DraftVariant[]; selectedIds: string[]; attributes: DraftAttribute[] },
): DraftVariant[] {
  if (target.kind === "all") return context.rows;
  if (target.kind === "selected") {
    const ids = new Set(context.selectedIds);
    return context.rows.filter((row) => ids.has(row.key) || (row.id ? ids.has(row.id) : false));
  }

  const criteria = (target.criteria ?? []).filter((criterion) => criterion.valueIds.length > 0);
  if (criteria.length === 0) return [];
  return context.rows.filter((row) =>
    criteria.every((criterion) => {
      const valueId = row.attributeValueIds.find((id) =>
        context.attributes.some(
          (attribute) => attribute.id === criterion.attributeId && attribute.values.some((value) => value.id === id),
        ),
      );
      return Boolean(valueId && criterion.valueIds.includes(valueId));
    }),
  );
}

/** How a bulk image action will affect the target group. */
export interface ImageActionImpact {
  /** Variants whose displayed image changes because of an inherited default. */
  inherited: number;
  /** Variants carrying their own image; preserved unless overrides are replaced. */
  overridden: number;
  /** Variants that already show the same asset. */
  unchanged: number;
}

export function imageActionImpact(
  target: DraftVariant[],
  context: { mediaId: string; productImageMediaId: string | null; attributes: DraftAttribute[] },
  options: { replaceOverrides: boolean; attributeValueId?: string | null },
): ImageActionImpact {
  let inherited = 0;
  let overridden = 0;
  let unchanged = 0;

  for (const row of target) {
    const current = resolveVariantImage({
      imageMediaId: row.imageMediaId,
      attributeValueIds: row.attributeValueIds,
      productImageMediaId: context.productImageMediaId,
      attributes: context.attributes,
    });
    if (current.mediaId === context.mediaId) {
      unchanged += 1;
      continue;
    }
    if (row.imageMediaId) {
      if (options.replaceOverrides) inherited += 1;
      else overridden += 1;
      continue;
    }
    inherited += 1;
  }

  return { inherited, overridden, unchanged };
}

/* -------------------------------------------------------------------------- */
/* SKU helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Normalise a SKU for comparison: SKUs are case-insensitive and trimmed. */
export function normalizeSku(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export const SKU_PATTERN = /^[A-Za-z0-9._\-/]+$/;

export function isValidSku(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 64 && SKU_PATTERN.test(trimmed);
}

/** Duplicate SKUs inside one submission (case-insensitive). */
export function duplicateSkus(skus: Array<string | null | undefined>): string[] {
  const seen = new Map<string, number>();
  for (const sku of skus) {
    const normalized = normalizeSku(sku);
    if (!normalized) continue;
    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([sku]) => sku);
}
