/**
 * Pure domain logic for catalog pricing, discounts, and property inheritance.
 *
 * Implements the 3-level property resolution system:
 *   Manual variant override > Attribute-level override > Product default
 */

export type DiscountType = "PERCENTAGE" | "FLAT" | "NONE";

export interface PricingCalculationInput {
  currentPricePaisa: number;
  discountType?: DiscountType | null;
  discountValue?: number | null; // percentage points (e.g. 15 for 15%) or flat paisa (e.g. 1500 for 15 Tk)
}

export interface PricingCalculationResult {
  currentPricePaisa: number;
  discountType: DiscountType;
  discountValue: number;
  discountPaisa: number;
  sellPricePaisa: number;
  compareAtPricePaisa: number | null;
}

/**
 * Calculate sell price and compare-at price from current price and discount.
 *
 * Guaranteed invariants:
 * - Integer precision in paisa (no floating-point rounding errors).
 * - Sell price is never negative and never exceeds current price.
 * - When a valid discount is present, compareAtPricePaisa is currentPricePaisa.
 * - When no discount is applied, compareAtPricePaisa is null and sellPrice equals currentPrice.
 */
export function calculatePricing(input: PricingCalculationInput): PricingCalculationResult {
  const currentPricePaisa = Math.max(0, Math.round(Number(input.currentPricePaisa) || 0));
  const discountType: DiscountType = input.discountType ?? "NONE";
  const rawDiscountValue = Number(input.discountValue) || 0;

  if (currentPricePaisa <= 0 || discountType === "NONE" || rawDiscountValue <= 0) {
    return {
      currentPricePaisa,
      discountType: "NONE",
      discountValue: 0,
      discountPaisa: 0,
      sellPricePaisa: currentPricePaisa,
      compareAtPricePaisa: null,
    };
  }

  let discountPaisa = 0;
  let normalizedValue = rawDiscountValue;

  if (discountType === "PERCENTAGE") {
    // Discount percentage between 0 and 100
    normalizedValue = Math.min(100, Math.max(0, rawDiscountValue));
    discountPaisa = Math.min(currentPricePaisa, Math.round((currentPricePaisa * normalizedValue) / 100));
  } else if (discountType === "FLAT") {
    // Flat amount in paisa
    normalizedValue = Math.max(0, Math.round(rawDiscountValue));
    discountPaisa = Math.min(currentPricePaisa, normalizedValue);
  }

  const sellPricePaisa = Math.max(0, currentPricePaisa - discountPaisa);
  const compareAtPricePaisa = discountPaisa > 0 ? currentPricePaisa : null;

  return {
    currentPricePaisa,
    discountType,
    discountValue: normalizedValue,
    discountPaisa,
    sellPricePaisa,
    compareAtPricePaisa,
  };
}

/* -------------------------------------------------------------------------- */
/* Three-level property inheritance resolution                                */
/* -------------------------------------------------------------------------- */

export type PropertyInheritanceSource = "MANUAL_VARIANT" | "ATTRIBUTE_OVERRIDE" | "PRODUCT_DEFAULT" | "NONE";

export interface ResolvedProperty<T> {
  value: T;
  source: PropertyInheritanceSource;
  isOverridden: boolean;
  isInherited: boolean;
  label: string;
}

/**
 * Resolve effective price for a variant across the three inheritance levels:
 * Precedence: Manual variant override > Attribute-level override > Product default.
 */
export function resolveEffectivePrice(params: {
  variantPricePaisa?: number | null;
  variantCompareAtPaisa?: number | null;
  attributePricePaisa?: number | null;
  productDefaultPricePaisa?: number | null;
  productCompareAtPaisa?: number | null;
}): ResolvedProperty<{ pricePaisa: number; compareAtPricePaisa: number | null }> {
  // Level 1: Manual variant override
  if (params.variantPricePaisa != null && params.variantPricePaisa > 0) {
    return {
      value: {
        pricePaisa: params.variantPricePaisa,
        compareAtPricePaisa: params.variantCompareAtPaisa ?? null,
      },
      source: "MANUAL_VARIANT",
      isOverridden: true,
      isInherited: false,
      label: "Custom variant price",
    };
  }

  // Level 2: Attribute-level override
  if (params.attributePricePaisa != null && params.attributePricePaisa > 0) {
    return {
      value: {
        pricePaisa: params.attributePricePaisa,
        compareAtPricePaisa: null,
      },
      source: "ATTRIBUTE_OVERRIDE",
      isOverridden: true,
      isInherited: true,
      label: "Inherited from attribute override",
    };
  }

  // Level 3: Product default
  if (params.productDefaultPricePaisa != null && params.productDefaultPricePaisa > 0) {
    return {
      value: {
        pricePaisa: params.productDefaultPricePaisa,
        compareAtPricePaisa: params.productCompareAtPaisa ?? null,
      },
      source: "PRODUCT_DEFAULT",
      isOverridden: false,
      isInherited: true,
      label: "Inherited from product default",
    };
  }

  return {
    value: { pricePaisa: 0, compareAtPricePaisa: null },
    source: "NONE",
    isOverridden: false,
    isInherited: false,
    label: "No price configured",
  };
}

/**
 * Resolve effective preorder eligibility across inheritance levels:
 * Manual variant override > Product default.
 */
export function resolveEffectivePreorder(params: {
  variantPreorderEnabled?: boolean | null;
  productPreorderEnabled: boolean;
}): ResolvedProperty<boolean> {
  if (params.variantPreorderEnabled != null) {
    return {
      value: params.variantPreorderEnabled,
      source: "MANUAL_VARIANT",
      isOverridden: true,
      isInherited: false,
      label: params.variantPreorderEnabled ? "Preorder enabled (variant override)" : "Preorder disabled (variant override)",
    };
  }

  return {
    value: params.productPreorderEnabled,
    source: "PRODUCT_DEFAULT",
    isOverridden: false,
    isInherited: true,
    label: params.productPreorderEnabled ? "Preorder enabled (inherited from product)" : "Preorder disabled (inherited from product)",
  };
}

/**
 * Resolve effective weight across inheritance levels:
 * Manual variant override > Product default.
 */
export function resolveEffectiveWeight(params: {
  variantWeightGrams?: number | null;
  productWeightGrams?: number | null;
}): ResolvedProperty<number | null> {
  if (params.variantWeightGrams != null) {
    return {
      value: params.variantWeightGrams,
      source: "MANUAL_VARIANT",
      isOverridden: true,
      isInherited: false,
      label: `${params.variantWeightGrams} g (variant override)`,
    };
  }

  if (params.productWeightGrams != null) {
    return {
      value: params.productWeightGrams,
      source: "PRODUCT_DEFAULT",
      isOverridden: false,
      isInherited: true,
      label: `${params.productWeightGrams} g (inherited from product)`,
    };
  }

  return {
    value: null,
    source: "NONE",
    isOverridden: false,
    isInherited: false,
    label: "No weight configured",
  };
}

/**
 * Resolve effective packaging cost across inheritance levels:
 * Manual variant override > Product default.
 */
export function resolveEffectivePackagingCost(params: {
  variantPackagingCostPaisa?: number | null;
  productPackagingCostPaisa: number;
}): ResolvedProperty<number> {
  if (params.variantPackagingCostPaisa != null) {
    return {
      value: params.variantPackagingCostPaisa,
      source: "MANUAL_VARIANT",
      isOverridden: true,
      isInherited: false,
      label: `${params.variantPackagingCostPaisa / 100} Tk (variant override)`,
    };
  }

  return {
    value: params.productPackagingCostPaisa,
    source: "PRODUCT_DEFAULT",
    isOverridden: false,
    isInherited: true,
    label: `${params.productPackagingCostPaisa / 100} Tk (inherited from product)`,
  };
}
