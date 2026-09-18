/**
 * Money utilities.
 *
 * All monetary values in the platform are integer minor units ("paisa" for
 * BDT, 1 BDT = 100 paisa). JavaScript floating point arithmetic is never used
 * for money — every operation here is integer arithmetic with explicit
 * rounding rules.
 */

export const MINOR_UNITS_PER_MAJOR = 100;
export const DEFAULT_CURRENCY = "BDT";

export class MoneyError extends Error {}

function assertInteger(value: number, label = "value"): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units (received ${value})`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range`);
  }
}

/** Sum any number of paisa values. */
export function sumPaisa(...values: number[]): number {
  let total = 0;
  for (const value of values) {
    assertInteger(value);
    total += value;
  }
  return total;
}

/** Multiply a unit price by a quantity using exact integer arithmetic. */
export function lineTotalPaisa(unitPricePaisa: number, quantity: number): number {
  assertInteger(unitPricePaisa, "unitPricePaisa");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer (received ${quantity})`);
  }
  const total = BigInt(unitPricePaisa) * BigInt(quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError("line total exceeds the safe integer range");
  return Number(total);
}

/**
 * Percentage of an amount expressed in basis points (1% = 100 bps).
 * Rounds half away from zero, which is the convention used for tax and
 * commission calculations in this platform.
 */
export function percentagePaisa(amountPaisa: number, basisPoints: number): number {
  assertInteger(amountPaisa, "amountPaisa");
  if (!Number.isInteger(basisPoints)) throw new MoneyError("basisPoints must be an integer");
  if (basisPoints === 0 || amountPaisa === 0) return 0;
  const numerator = BigInt(amountPaisa) * BigInt(basisPoints);
  const denominator = 10_000n;
  const rounded = divideRoundHalfAwayFromZero(numerator, denominator);
  return Number(rounded);
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const roundedUp = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return negative ? -roundedUp : roundedUp;
}

/** Round an amount to the nearest whole currency unit (100 paisa). */
export function roundToMajorUnit(amountPaisa: number): number {
  assertInteger(amountPaisa, "amountPaisa");
  return Number(divideRoundHalfAwayFromZero(BigInt(amountPaisa), 100n)) * 100;
}

/**
 * Allocate `totalPaisa` across `weights` proportionally without losing or
 * inventing a single paisa (the remainder goes to the largest weights first).
 * Used to spread purchase expenses and order level discounts over lines.
 */
export function allocateProportionally(totalPaisa: number, weights: number[]): number[] {
  assertInteger(totalPaisa, "totalPaisa");
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    // Fall back to an equal split, remainder to the first entries.
    const base = Math.trunc(totalPaisa / weights.length);
    let remainder = totalPaisa - base * weights.length;
    return weights.map(() => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return base + extra;
    });
  }

  const allocations: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index] ?? 0;
    const share = Number(divideRoundHalfAwayFromZero(BigInt(totalPaisa) * BigInt(weight), BigInt(totalWeight)));
    allocations.push(share);
    allocated += share;
  }

  // Distribute the rounding difference deterministically (largest weight first).
  let difference = totalPaisa - allocated;
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => (b.weight - a.weight) || (a.index - b.index));
  let cursor = 0;
  while (difference !== 0 && order.length > 0) {
    const entry = order[cursor % order.length];
    if (entry) {
      allocations[entry.index] = (allocations[entry.index] ?? 0) + Math.sign(difference);
      difference -= Math.sign(difference);
    }
    cursor += 1;
    if (cursor > weights.length * 4) break;
  }
  return allocations;
}

/**
 * Weighted average cost after receiving new stock.
 * newAverage = (oldQuantity * oldAverage + receivedQuantity * receivedUnitCost) / (oldQuantity + receivedQuantity)
 */
export function weightedAverageCostPaisa(input: {
  oldQuantity: number;
  oldAverageCostPaisa: number;
  receivedQuantity: number;
  receivedUnitCostPaisa: number;
}): number {
  const { oldQuantity, oldAverageCostPaisa, receivedQuantity, receivedUnitCostPaisa } = input;
  assertInteger(oldAverageCostPaisa, "oldAverageCostPaisa");
  assertInteger(receivedUnitCostPaisa, "receivedUnitCostPaisa");
  const totalQuantity = oldQuantity + receivedQuantity;
  if (totalQuantity <= 0) return 0;
  const oldValue = BigInt(oldQuantity) * BigInt(oldAverageCostPaisa);
  const newValue = BigInt(receivedQuantity) * BigInt(receivedUnitCostPaisa);
  const average = divideRoundHalfAwayFromZero(oldValue + newValue, BigInt(totalQuantity));
  return Number(average);
}

/** Format paisa for display, e.g. 123456 -> "৳1,234.56". */
export function formatPaisa(amountPaisa: number, options: { currency?: string; withSymbol?: boolean; locale?: string } = {}): string {
  const { currency = DEFAULT_CURRENCY, withSymbol = true, locale = "en-BD" } = options;
  assertInteger(amountPaisa, "amountPaisa");
  const major = amountPaisa / MINOR_UNITS_PER_MAJOR;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  if (!withSymbol) return formatted;
  if (currency === "BDT") return `৳${formatted}`;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(major);
  } catch {
    return `${currency} ${formatted}`;
  }
}

/** Parse a human entered amount ("1,234.56", "1234") into paisa. */
export function parseAmountToPaisa(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("Amount must be a number");
    return Math.round(input * MINOR_UNITS_PER_MAJOR);
  }
  const cleaned = input.replace(/[৳,\s]/g, "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`Invalid amount: "${input}"`);
  }
  const negative = cleaned.startsWith("-");
  const [wholePart, fractionPart = ""] = cleaned.replace("-", "").split(".");
  const fraction = `${fractionPart}00`.slice(0, 2);
  const paisa = Number(wholePart) * MINOR_UNITS_PER_MAJOR + Number(fraction);
  if (!Number.isSafeInteger(paisa)) throw new MoneyError("Amount is too large");
  return negative ? -paisa : paisa;
}

/** Convert paisa to a decimal number of currency units (display/reporting only). */
export function paisaToMajorUnits(amountPaisa: number): number {
  assertInteger(amountPaisa, "amountPaisa");
  return Number((amountPaisa / MINOR_UNITS_PER_MAJOR).toFixed(2));
}

/** Discount amount for a percentage expressed in basis points. */
export function discountFromBps(amountPaisa: number, bps: number): number {
  return percentagePaisa(amountPaisa, bps);
}

/** Gross profit for a line/order: revenue minus inventory cost. */
export function grossProfitPaisa(revenuePaisa: number, inventoryCostPaisa: number): number {
  assertInteger(revenuePaisa, "revenuePaisa");
  assertInteger(inventoryCostPaisa, "inventoryCostPaisa");
  return revenuePaisa - inventoryCostPaisa;
}

/** Margin in basis points (revenue 0 => 0). */
export function marginBps(revenuePaisa: number, inventoryCostPaisa: number): number {
  if (revenuePaisa <= 0) return 0;
  const profit = grossProfitPaisa(revenuePaisa, inventoryCostPaisa);
  return Math.round((profit / revenuePaisa) * 10_000);
}

/** Clamp a paisa amount between bounds (defensive helper for server totals). */
export function clampPaisa(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  assertInteger(value);
  return Math.min(Math.max(value, min), max);
}
