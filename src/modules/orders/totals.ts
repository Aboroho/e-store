import { allocateProportionally, lineTotalPaisa, percentagePaisa } from "@/lib/money";
import type { OrderTypeValue } from "@/modules/orders/status";

/**
 * Order totals for manual order creation and editing.
 *
 * Every amount is an integer number of paisa and every operation is integer
 * arithmetic from `@/lib/money` — no floating point anywhere near money. The
 * same function runs for the live preview shown in the UI and for the
 * authoritative calculation inside the create/update transaction, so what the
 * operator saw is what gets stored (and a tampered client payload can only make
 * the server recalculate, never change the result).
 *
 * Formula (docs/BUSINESS_RULES.md → "Manual order totals"):
 *
 *   lineSubtotal   = unitPrice × quantity
 *   lineNet        = lineSubtotal − min(itemDiscount, lineSubtotal)
 *   itemsSubtotal  = Σ lineSubtotal
 *   itemDiscount   = Σ min(itemDiscount, lineSubtotal)
 *   netItems       = itemsSubtotal − itemDiscount
 *   orderDiscount  = FLAT: min(value, netItems, cap)
 *                    PERCENTAGE: min(round(netItems × bps / 10000), netItems, cap)
 *   deliveryFee    = manual override when authorised, otherwise the zone charge
 *                    (always 0 for in-store orders)
 *   grandTotal     = netItems − orderDiscount + deliveryFee + extraCharges
 *                    + packagingCost + codSurcharge
 *   collectible    = grandTotal (COD / in-store counter collection)
 */

export type OrderDiscountTypeValue = "FLAT" | "PERCENTAGE";

export interface ManualOrderLineInput {
  /** Client-side row key; echoed back so the UI can match lines. */
  key: string;
  variantId: string;
  quantity: number;
  /** Resolved on the server. A client-supplied unit price is never accepted. */
  unitPricePaisa: number;
  itemDiscountPaisa?: number;
  packagingCostPaisa?: number;
  unitCostPaisa?: number;
}

export interface ManualOrderTotalsInput {
  orderType: OrderTypeValue;
  lines: ManualOrderLineInput[];
  /** `value` is paisa for FLAT and basis points for PERCENTAGE (250 = 2.50%). */
  orderDiscount?: { type: OrderDiscountTypeValue; value: number } | null;
  /** Maximum order-level discount in basis points (default 10000 = 100%). */
  maxDiscountBps?: number;
  deliveryFee?: { calculatedPaisa: number; manualPaisa?: number | null };
  extraChargesPaisa?: number;
  codSurchargePaisa?: number;
  /** COD surcharge only applies to cash-on-payment orders. */
  paymentMethod?: string;
}

export interface ManualOrderLineTotals {
  key: string;
  variantId: string;
  quantity: number;
  unitPricePaisa: number;
  lineSubtotalPaisa: number;
  itemDiscountPaisa: number;
  lineNetPaisa: number;
  orderDiscountSharePaisa: number;
  lineTotalPaisa: number;
  packagingCostPaisa: number;
}

export interface ManualOrderTotals {
  lines: ManualOrderLineTotals[];
  itemsSubtotalPaisa: number;
  itemDiscountPaisa: number;
  netItemsPaisa: number;
  orderDiscountPaisa: number;
  /** What the operator asked for before caps — used for the UI hint. */
  orderDiscountRequestedPaisa: number;
  deliveryFeePaisa: number;
  deliveryFeeCalculatedPaisa: number;
  deliveryFeeOverridden: boolean;
  extraChargePaisa: number;
  packagingCostPaisa: number;
  codSurchargePaisa: number;
  inventoryCostPaisa: number;
  grandTotalPaisa: number;
  collectiblePaisa: number;
  totalUnits: number;
  warnings: string[];
}

/** Default cap for an order-level discount: 100% of the net item value. */
export const DEFAULT_MAX_DISCOUNT_BPS = 10_000;

export function calculateManualOrderTotals(input: ManualOrderTotalsInput): ManualOrderTotals {
  const warnings: string[] = [];
  const maxDiscountBps = input.maxDiscountBps ?? DEFAULT_MAX_DISCOUNT_BPS;

  let itemsSubtotalPaisa = 0;
  let itemDiscountPaisa = 0;
  let packagingCostPaisa = 0;
  let inventoryCostPaisa = 0;
  let totalUnits = 0;

  const prepared = input.lines.map((line) => {
    const quantity = Math.max(0, Math.trunc(line.quantity));
    const subtotal = lineTotalPaisa(line.unitPricePaisa, quantity);
    const requestedDiscount = Math.max(0, Math.trunc(line.itemDiscountPaisa ?? 0));
    const discount = Math.min(requestedDiscount, subtotal);
    if (requestedDiscount > discount) {
      warnings.push(`The discount on line ${line.key} was limited to the line subtotal`);
    }
    const packaging = Math.max(0, Math.trunc(line.packagingCostPaisa ?? 0)) * quantity;
    itemsSubtotalPaisa += subtotal;
    itemDiscountPaisa += discount;
    packagingCostPaisa += packaging;
    inventoryCostPaisa += Math.max(0, Math.trunc(line.unitCostPaisa ?? 0)) * quantity;
    totalUnits += quantity;
    return { line, quantity, subtotal, discount, packaging, net: subtotal - discount };
  });

  const netItemsPaisa = itemsSubtotalPaisa - itemDiscountPaisa;

  // ---------------------------------------------------------------- discount
  const discount = input.orderDiscount ?? null;
  let orderDiscountRequestedPaisa = 0;
  let orderDiscountPaisa = 0;
  if (discount && discount.value > 0) {
    orderDiscountRequestedPaisa =
      discount.type === "PERCENTAGE" ? percentagePaisa(netItemsPaisa, Math.trunc(discount.value)) : Math.trunc(discount.value);
    const cap = percentagePaisa(netItemsPaisa, maxDiscountBps);
    orderDiscountPaisa = Math.min(orderDiscountRequestedPaisa, netItemsPaisa, cap);
    if (orderDiscountPaisa < orderDiscountRequestedPaisa) {
      warnings.push("The order discount was limited to the allowed maximum");
    }
  }

  // Allocate the order-level discount over the lines proportionally to their net
  // value so every stored line adds up exactly to the order total (largest
  // remainder first, no paisa lost or invented).
  const shares = allocateProportionally(
    orderDiscountPaisa,
    prepared.map((entry) => entry.net),
  );

  const lines: ManualOrderLineTotals[] = prepared.map((entry, index) => ({
    key: entry.line.key,
    variantId: entry.line.variantId,
    quantity: entry.quantity,
    unitPricePaisa: entry.line.unitPricePaisa,
    lineSubtotalPaisa: entry.subtotal,
    itemDiscountPaisa: entry.discount,
    lineNetPaisa: entry.net,
    orderDiscountSharePaisa: shares[index] ?? 0,
    lineTotalPaisa: entry.net - (shares[index] ?? 0),
    packagingCostPaisa: entry.packaging,
  }));

  // ------------------------------------------------------------- delivery fee
  const calculated = Math.max(0, Math.trunc(input.deliveryFee?.calculatedPaisa ?? 0));
  const manual = input.deliveryFee?.manualPaisa;
  let deliveryFeePaisa = calculated;
  let deliveryFeeOverridden = false;
  if (input.orderType === "IN_STORE") {
    // Counter sales never carry a courier delivery charge.
    if (calculated > 0 || (manual != null && manual > 0)) {
      warnings.push("Delivery charges do not apply to in-store orders");
    }
    deliveryFeePaisa = 0;
  } else if (manual != null && Math.trunc(manual) !== calculated) {
    deliveryFeePaisa = Math.max(0, Math.trunc(manual));
    deliveryFeeOverridden = true;
  }

  const extraChargePaisa = Math.max(0, Math.trunc(input.extraChargesPaisa ?? 0));
  const codSurchargePaisa =
    (input.paymentMethod ?? "COD") === "COD" && input.orderType !== "IN_STORE"
      ? Math.max(0, Math.trunc(input.codSurchargePaisa ?? 0))
      : 0;

  const rawTotal =
    netItemsPaisa - orderDiscountPaisa + deliveryFeePaisa + extraChargePaisa + packagingCostPaisa + codSurchargePaisa;
  const grandTotalPaisa = Math.max(0, rawTotal);
  if (rawTotal < 0) {
    warnings.push("The discounts exceeded the order value; the collectible amount was floored at zero");
  }

  return {
    lines,
    itemsSubtotalPaisa,
    itemDiscountPaisa,
    netItemsPaisa,
    orderDiscountPaisa,
    orderDiscountRequestedPaisa,
    deliveryFeePaisa,
    deliveryFeeCalculatedPaisa: input.orderType === "IN_STORE" ? 0 : calculated,
    deliveryFeeOverridden,
    extraChargePaisa,
    packagingCostPaisa,
    codSurchargePaisa,
    inventoryCostPaisa,
    grandTotalPaisa,
    collectiblePaisa: grandTotalPaisa,
    totalUnits,
    warnings,
  };
}

/** Per-line allocation snapshot stored on the order (`discountAllocation`). */
export function discountAllocationSnapshot(totals: ManualOrderTotals): Array<{ key: string; variantId: string; paisa: number }> {
  return totals.lines
    .filter((line) => line.orderDiscountSharePaisa > 0)
    .map((line) => ({ key: line.key, variantId: line.variantId, paisa: line.orderDiscountSharePaisa }));
}
