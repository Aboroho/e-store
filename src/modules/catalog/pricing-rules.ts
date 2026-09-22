/**
 * Pure domain logic for money: discounts, sell-price derivation and validation.
 *
 * The three-level property resolution that uses these calculations lives in
 * `src/modules/catalog/inheritance.ts` — this file only knows how to turn a
 * current price plus a discount into a sell price, in integer paisa, with no
 * floating-point drift and no negative or above-list results.
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
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface DiscountValidationInput {
  currentPricePaisa?: number | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
}

export interface DiscountValidationResult {
  ok: boolean;
  message: string | null;
}

/**
 * Guard rails the editor, the bulk dialog and the server action all share:
 *
 * - a discount needs a current price to discount;
 * - a percentage stays within 0–100;
 * - a flat discount may not exceed the current price (a product cannot be sold
 *   below zero by a discount — use a price override if that is really wanted);
 * - money stays integer paisa.
 */
export function validateDiscount(input: DiscountValidationInput): DiscountValidationResult {
  const type = input.discountType ?? "NONE";
  const value = Number(input.discountValue ?? 0);

  if (type === "NONE") {
    return value > 0
      ? { ok: false, message: "Choose a discount type before entering a discount value." }
      : { ok: true, message: null };
  }

  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: "Enter a discount of zero or more." };
  }
  if (Math.round(value) !== value && type === "FLAT") {
    return { ok: false, message: "Flat discounts are stored in paisa — enter a whole number." };
  }

  const current = Number(input.currentPricePaisa ?? 0);
  if (current <= 0) {
    return { ok: false, message: "Enter a current price before applying a discount." };
  }
  if (type === "PERCENTAGE" && value > 100) {
    return { ok: false, message: "A percentage discount cannot exceed 100%." };
  }
  if (type === "FLAT" && value > current) {
    return { ok: false, message: "A flat discount cannot be larger than the current price." };
  }

  return { ok: true, message: null };
}

/** Normalise a discount triple so empty/invalid input degrades to "no discount". */
export function normalizeDiscount(input: DiscountValidationInput): {
  discountType: DiscountType;
  discountValue: number;
} {
  const type = input.discountType ?? "NONE";
  const value = Number.isFinite(Number(input.discountValue)) ? Math.max(0, Number(input.discountValue)) : 0;
  if (type === "NONE" || value <= 0) return { discountType: "NONE", discountValue: 0 };
  return { discountType: type, discountValue: value };
}
