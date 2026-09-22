/**
 * Property inheritance — the single resolution model for the catalogue.
 *
 * Every inheritable property (price, image, weight, preorder, packaging cost,
 * cost) resolves through the same three levels:
 *
 *   1. **Product default**      — the product's own value (level 3, broadest).
 *   2. **Attribute-level**      — an override stored on an attribute *value*
 *                                 ("Colour: Black costs 1,500 Tk"), which every
 *                                 variant carrying that value picks up.
 *   3. **Manual variant**       — an explicit override on one variant.
 *
 * Precedence is always `manual variant > attribute override > product default`.
 *
 * This file is pure (no I/O, no `server-only`) on purpose: the product editor,
 * the bulk-action preview, the product list, the storefront, the manual order
 * screen and the order service all call exactly these functions, so the number
 * a merchandiser sees is the number the platform charges.
 */

import { calculatePricing, type DiscountType } from "./pricing-rules";

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export type InheritanceLevel = "VARIANT" | "ATTRIBUTE" | "PRODUCT" | "NONE";

/** How a value was reached — enough for the UI to badge it without guessing. */
export interface ResolvedValue<T> {
  value: T;
  level: InheritanceLevel;
  /** True when the winning value was written on the variant itself. */
  isOverride: boolean;
  /** True when the value came from a broader level than the variant. */
  isInherited: boolean;
  /** Human sentence used by tooltips, tables and API responses. */
  label: string;
  /** Badge text used in dense tables ("override", "attribute", "inherited"). */
  badge: string;
  /** Which attribute value supplied an attribute-level value, when one did. */
  attributeValueId?: string | null;
  attributeName?: string | null;
  attributeValueLabel?: string | null;
}

function badgeFor(level: InheritanceLevel): string {
  switch (level) {
    case "VARIANT":
      return "override";
    case "ATTRIBUTE":
      return "attribute";
    case "PRODUCT":
      return "inherited";
    default:
      return "unset";
  }
}

function result<T>(
  value: T,
  level: InheritanceLevel,
  label: string,
  attribute?: { attributeValueId?: string | null; attributeName?: string | null; attributeValueLabel?: string | null },
): ResolvedValue<T> {
  return {
    value,
    level,
    isOverride: level === "VARIANT" || level === "ATTRIBUTE",
    isInherited: level !== "NONE",
    label,
    badge: badgeFor(level),
    ...(attribute ?? {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Generic resolver                                                           */
/* -------------------------------------------------------------------------- */

export interface AttributeCandidate<T> {
  attributeValueId: string;
  attributeName?: string | null;
  valueLabel?: string | null;
  value: T;
}

/**
 * Resolve one property across the three levels.
 *
 * `has` decides whether a level actually carries a value — `null`, `undefined`
 * and (for numbers) `0` are treated as "not set" by the default predicate so an
 * empty override never shadows a real default.
 */
export function resolveInherited<T>(input: {
  productDefault: T | null | undefined;
  attributeValues: Array<AttributeCandidate<T>>;
  variantOverride: T | null | undefined;
  labels: {
    variant: string;
    attribute: (candidate: AttributeCandidate<T>) => string;
    product: string;
    none: string;
  };
  has?: (value: T | null | undefined) => boolean;
  /** When true the variant override is ignored (the user cleared it). */
  clearOverride?: boolean;
}): ResolvedValue<T | null> {
  const has = input.has ?? ((value: T | null | undefined) => value !== null && value !== undefined);

  if (!input.clearOverride && has(input.variantOverride)) {
    return result<T | null>(input.variantOverride ?? null, "VARIANT", input.labels.variant);
  }

  // Attribute order matters: the first attribute of the product wins, so a
  // "Colour" image beats a "Size" image — the same order the variant table
  // displays its columns in.
  for (const candidate of input.attributeValues) {
    if (has(candidate.value)) {
      return result<T | null>(candidate.value, "ATTRIBUTE", input.labels.attribute(candidate), {
        attributeValueId: candidate.attributeValueId,
        attributeName: candidate.attributeName ?? null,
        attributeValueLabel: candidate.valueLabel ?? null,
      });
    }
  }

  if (has(input.productDefault)) {
    return result<T | null>(input.productDefault ?? null, "PRODUCT", input.labels.product);
  }

  return result<T | null>(null, "NONE", input.labels.none);
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

/** The pricing triple any level can carry. */
export interface PricingLevelInput {
  /** Struck-through "was" price, in paisa. */
  currentPricePaisa?: number | null;
  discountType?: DiscountType | null;
  /** Percentage points (15 = 15%) or a flat amount in paisa. */
  discountValue?: number | null;
  /** Explicitly stored sell price. Used when a level stores the result only. */
  pricePaisa?: number | null;
  compareAtPricePaisa?: number | null;
}

export interface ResolvedPricing extends ResolvedValue<{
  pricePaisa: number;
  currentPricePaisa: number;
  compareAtPricePaisa: number | null;
  discountType: DiscountType;
  discountValue: number;
  discountPaisa: number;
}> {
  /** Convenience accessors so callers do not have to unwrap `value`. */
  sellPricePaisa: number;
}

/** A level contributes pricing when it has a sell price or a current price. */
export function hasPricing(level: PricingLevelInput | null | undefined): boolean {
  if (!level) return false;
  const current = level.currentPricePaisa ?? null;
  const price = level.pricePaisa ?? null;
  return (price != null && price > 0) || (current != null && current > 0);
}

/** Convert one level's input into a concrete price triple. */
export function pricingFromLevel(level: PricingLevelInput | null | undefined): {
  pricePaisa: number;
  currentPricePaisa: number;
  compareAtPricePaisa: number | null;
  discountType: DiscountType;
  discountValue: number;
  discountPaisa: number;
} {
  const currentPricePaisa = Math.max(0, Math.round(Number(level?.currentPricePaisa ?? 0) || 0));
  const discountType: DiscountType = level?.discountType ?? "NONE";
  const discountValue = Math.max(0, Number(level?.discountValue ?? 0) || 0);
  const calculated = calculatePricing({ currentPricePaisa, discountType, discountValue });
  const storedPrice = level?.pricePaisa != null && level.pricePaisa > 0 ? Math.round(level.pricePaisa) : null;

  // An explicitly stored sell price wins over the derived one (price lists and
  // older rows store the result); the discount context is still reported so the
  // UI can explain the number.
  const sellPricePaisa = storedPrice ?? calculated.sellPricePaisa;
  const compareAtPricePaisa =
    level?.compareAtPricePaisa != null && level.compareAtPricePaisa > 0
      ? Math.round(level.compareAtPricePaisa)
      : calculated.compareAtPricePaisa ?? (storedPrice != null && currentPricePaisa > storedPrice ? currentPricePaisa : null);

  return {
    pricePaisa: sellPricePaisa,
    currentPricePaisa: currentPricePaisa || sellPricePaisa,
    compareAtPricePaisa,
    discountType: calculated.discountType,
    discountValue: calculated.discountValue,
    discountPaisa: currentPricePaisa > 0 ? Math.max(0, currentPricePaisa - sellPricePaisa) : calculated.discountPaisa,
  };
}

/**
 * Resolve the effective price of one variant.
 *
 * Precedence: manual variant override → attribute-value override → product
 * default. The returned object keeps both the money and *why* it was chosen.
 */
export function resolvePricing(input: {
  productDefault: PricingLevelInput | null | undefined;
  attributeValues: Array<AttributeCandidate<PricingLevelInput>>;
  variantOverride: PricingLevelInput | null | undefined;
  clearOverride?: boolean;
}): ResolvedPricing {
  const resolved = resolveInherited<PricingLevelInput>({
    productDefault: hasPricing(input.productDefault) ? input.productDefault : null,
    attributeValues: input.attributeValues.filter((candidate) => hasPricing(candidate.value)),
    variantOverride: hasPricing(input.variantOverride) ? input.variantOverride : null,
    clearOverride: input.clearOverride,
    labels: {
      variant: "Custom variant price",
      attribute: (candidate) =>
        `Inherited from ${candidate.attributeName ?? "attribute"}: ${candidate.valueLabel ?? "value"}`,
      product: "Inherited from product default",
      none: "No price configured",
    },
  });

  const pricing = resolved.value ? pricingFromLevel(resolved.value) : pricingFromLevel(null);
  return {
    ...resolved,
    value: pricing,
    sellPricePaisa: pricing.pricePaisa,
  };
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResolvedImage extends ResolvedValue<string | null> {
  mediaId: string | null;
}

/**
 * The effective image of a variant:
 * variant override → attribute-value default → product primary image.
 *
 * The same function drives the editor row, the product list, the storefront
 * gallery and the cart thumbnail.
 */
export function resolveImage(input: {
  variantImageMediaId?: string | null;
  attributeValues: Array<AttributeCandidate<string | null>>;
  productImageMediaId?: string | null;
  clearOverride?: boolean;
}): ResolvedImage {
  const resolved = resolveInherited<string | null>({
    productDefault: input.productImageMediaId ?? null,
    attributeValues: input.attributeValues,
    variantOverride: input.variantImageMediaId ?? null,
    clearOverride: input.clearOverride,
    labels: {
      variant: "Custom variant image",
      attribute: (candidate) => `Inherited from ${candidate.attributeName ?? "attribute"}: ${candidate.valueLabel ?? "value"}`,
      product: "Inherited from product primary image",
      none: "No image",
    },
  });
  return { ...resolved, mediaId: resolved.value };
}

/**
 * Ordering of the public product gallery:
 * 1. the main product's primary image,
 * 2. the images of the variants (in variant order),
 * 3. the additional product gallery images.
 *
 * Duplicates and missing/unavailable assets are dropped, and the primary image
 * is never repeated further down the list.
 */
export function publicImageOrder(input: {
  productPrimaryMediaId?: string | null;
  productGalleryMediaIds?: string[];
  variantImages?: Array<string | null | undefined>;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (mediaId?: string | null) => {
    if (!mediaId) return;
    if (seen.has(mediaId)) return;
    seen.add(mediaId);
    ordered.push(mediaId);
  };

  push(input.productPrimaryMediaId);
  for (const mediaId of input.variantImages ?? []) push(mediaId);
  for (const mediaId of input.productGalleryMediaIds ?? []) push(mediaId);
  return ordered;
}

/* -------------------------------------------------------------------------- */
/* Booleans, numbers and money                                                */
/* -------------------------------------------------------------------------- */

/** Preorder eligibility: variant override wins over the product default. */
export function resolvePreorder(input: {
  productEnabled: boolean;
  variantOverride?: boolean | null;
  storefrontEnabled?: boolean;
  clearOverride?: boolean;
}): ResolvedValue<boolean> {
  const resolved = resolveInherited<boolean>({
    productDefault: input.productEnabled,
    attributeValues: [],
    variantOverride: input.variantOverride ?? null,
    clearOverride: input.clearOverride,
    labels: {
      variant: input.variantOverride ? "Preorder enabled (variant override)" : "Preorder disabled (variant override)",
      attribute: () => "",
      product: input.productEnabled ? "Preorder enabled (inherited from product)" : "Preorder disabled (inherited from product)",
      none: "Preorder disabled",
    },
  });

  const value = Boolean(resolved.value) && input.storefrontEnabled !== false;
  return {
    ...resolved,
    value,
    label: input.storefrontEnabled === false ? "Preorder disabled for this storefront" : resolved.label,
  };
}

/** Weight in grams: variant override → product default. */
export function resolveWeight(input: {
  productWeightGrams?: number | null;
  variantWeightGrams?: number | null;
  clearOverride?: boolean;
}): ResolvedValue<number | null> {
  return resolveInherited<number>({
    productDefault: input.productWeightGrams ?? null,
    attributeValues: [],
    variantOverride: input.variantWeightGrams ?? null,
    clearOverride: input.clearOverride,
    has: (value) => value != null && value > 0,
    labels: {
      variant: `${input.variantWeightGrams ?? 0} g (variant override)`,
      attribute: () => "",
      product: `${input.productWeightGrams ?? 0} g (inherited from product)`,
      none: "No weight configured",
    },
  });
}

/** Packaging cost in paisa: variant override → product default. */
export function resolvePackagingCost(input: {
  productPackagingCostPaisa?: number | null;
  variantPackagingCostPaisa?: number | null;
  clearOverride?: boolean;
}): ResolvedValue<number> {
  const resolved = resolveInherited<number>({
    productDefault: input.productPackagingCostPaisa ?? 0,
    attributeValues: [],
    variantOverride: input.variantPackagingCostPaisa ?? null,
    clearOverride: input.clearOverride,
    has: (value) => value != null && value >= 0,
    labels: {
      variant: `${((input.variantPackagingCostPaisa ?? 0) / 100).toFixed(2)} Tk (variant override)`,
      attribute: () => "",
      product: `${((input.productPackagingCostPaisa ?? 0) / 100).toFixed(2)} Tk (inherited from product)`,
      none: "No packaging cost",
    },
  });
  return { ...resolved, value: resolved.value ?? 0 };
}

/** Purchase cost in paisa: variant override → product default (never negative). */
export function resolveCost(input: {
  productCostPaisa?: number | null;
  variantCostPaisa?: number | null;
  clearOverride?: boolean;
}): ResolvedValue<number | null> {
  return resolveInherited<number>({
    productDefault: input.productCostPaisa ?? null,
    attributeValues: [],
    variantOverride: input.variantCostPaisa ?? null,
    clearOverride: input.clearOverride,
    has: (value) => value != null && value >= 0,
    labels: {
      variant: "Custom variant cost",
      attribute: () => "",
      product: "Inherited from product default cost",
      none: "No cost recorded",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Bulk updates                                                               */
/* -------------------------------------------------------------------------- */

export type OverrideTarget = "variant" | "attribute" | "product" | "clear";

/**
 * Where a bulk edit should write.
 *
 * Targeting "Colour = Black" and setting a price writes the attribute-value
 * override so future Black variants inherit it too; targeting explicit rows
 * writes the variant override; `clear` removes the override and restores
 * inheritance. The bulk dialog asks the operator to pick the level rather than
 * silently overwriting manual values.
 */
export function describeOverrideTarget(target: OverrideTarget): string {
  switch (target) {
    case "variant":
      return "Set a manual override on the selected variants";
    case "attribute":
      return "Set an attribute-level override (every variant of that value inherits it)";
    case "product":
      return "Change the product default (variants without an override follow it)";
    case "clear":
      return "Clear the override and restore inheritance";
    default:
      return "";
  }
}
