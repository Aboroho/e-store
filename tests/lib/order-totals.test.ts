import { describe, expect, it } from "vitest";
import { calculateManualOrderTotals, discountAllocationSnapshot } from "@/modules/orders/totals";

describe("calculateManualOrderTotals", () => {
  it("calculates simple item totals without discounts", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      lines: [
        { key: "l1", variantId: "v1", quantity: 2, unitPricePaisa: 50_000, unitCostPaisa: 30_000, packagingCostPaisa: 500 },
        { key: "l2", variantId: "v2", quantity: 1, unitPricePaisa: 30_000, unitCostPaisa: 20_000, packagingCostPaisa: 500 },
      ],
      deliveryFee: { calculatedPaisa: 6_000 },
    });

    expect(totals.itemsSubtotalPaisa).toBe(130_000); // 2*50000 + 1*30000
    expect(totals.itemDiscountPaisa).toBe(0);
    expect(totals.netItemsPaisa).toBe(130_000);
    expect(totals.orderDiscountPaisa).toBe(0);
    expect(totals.deliveryFeePaisa).toBe(6_000);
    expect(totals.deliveryFeeOverridden).toBe(false);
    expect(totals.packagingCostPaisa).toBe(1_500); // 3 units * 500
    expect(totals.inventoryCostPaisa).toBe(80_000); // 2*30000 + 1*20000
    expect(totals.grandTotalPaisa).toBe(130_000 + 6_000 + 1_500); // 137,500
    expect(totals.totalUnits).toBe(3);
    expect(totals.warnings).toHaveLength(0);
  });

  it("handles line item discounts capped to subtotal", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      lines: [
        // subtotal is 10,000, requested discount is 15,000 -> capped at 10,000
        { key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 10_000, itemDiscountPaisa: 15_000 },
      ],
      deliveryFee: { calculatedPaisa: 0 },
    });

    expect(totals.itemDiscountPaisa).toBe(10_000);
    expect(totals.netItemsPaisa).toBe(0);
    expect(totals.grandTotalPaisa).toBe(0);
    expect(totals.warnings.some((w) => w.includes("limited to the line subtotal"))).toBe(true);
  });

  it("applies percentage order discounts and allocates proportionally with largest remainder", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      lines: [
        { key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 10_000 }, // 100 Tk
        { key: "l2", variantId: "v2", quantity: 1, unitPricePaisa: 20_000 }, // 200 Tk
      ],
      orderDiscount: { type: "PERCENTAGE", value: 1000 }, // 10% (1000 bps)
      deliveryFee: { calculatedPaisa: 5_000 },
    });

    expect(totals.itemsSubtotalPaisa).toBe(30_000);
    expect(totals.orderDiscountPaisa).toBe(3_000); // 10% of 30,000
    expect(totals.lines[0]?.orderDiscountSharePaisa).toBe(1_000); // 1/3 of 3000
    expect(totals.lines[1]?.orderDiscountSharePaisa).toBe(2_000); // 2/3 of 3000
    expect(totals.lines[0]?.lineTotalPaisa).toBe(9_000);
    expect(totals.lines[1]?.lineTotalPaisa).toBe(18_000);
    expect(totals.grandTotalPaisa).toBe(30_000 - 3_000 + 5_000); // 32,000

    const snapshot = discountAllocationSnapshot(totals);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]?.paisa).toBe(1_000);
    expect(snapshot[1]?.paisa).toBe(2_000);
  });

  it("enforces max discount bps caps", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      lines: [{ key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 100_000 }],
      orderDiscount: { type: "PERCENTAGE", value: 5000 }, // 50%
      maxDiscountBps: 2000, // max 20%
    });

    expect(totals.orderDiscountRequestedPaisa).toBe(50_000);
    expect(totals.orderDiscountPaisa).toBe(20_000); // capped at 20%
    expect(totals.warnings.some((w) => w.includes("limited to the allowed maximum"))).toBe(true);
  });

  it("handles delivery fee manual override", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      lines: [{ key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 10_000 }],
      deliveryFee: { calculatedPaisa: 12_000, manualPaisa: 6_000 },
    });

    expect(totals.deliveryFeeCalculatedPaisa).toBe(12_000);
    expect(totals.deliveryFeePaisa).toBe(6_000);
    expect(totals.deliveryFeeOverridden).toBe(true);
    expect(totals.grandTotalPaisa).toBe(16_000);
  });

  it("zeros delivery fee for in-store orders and warns if delivery fee was specified", () => {
    const totals = calculateManualOrderTotals({
      orderType: "IN_STORE",
      lines: [{ key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 10_000 }],
      deliveryFee: { calculatedPaisa: 6_000, manualPaisa: 6_000 },
    });

    expect(totals.deliveryFeeCalculatedPaisa).toBe(0);
    expect(totals.deliveryFeePaisa).toBe(0);
    expect(totals.deliveryFeeOverridden).toBe(false);
    expect(totals.warnings.some((w) => w.includes("do not apply to in-store"))).toBe(true);
    expect(totals.grandTotalPaisa).toBe(10_000);
  });

  it("includes extra charges and COD surcharge correctly", () => {
    const totals = calculateManualOrderTotals({
      orderType: "ONLINE_DELIVERY",
      paymentMethod: "COD",
      lines: [{ key: "l1", variantId: "v1", quantity: 1, unitPricePaisa: 10_000 }],
      extraChargesPaisa: 2_000,
      codSurchargePaisa: 1_000,
    });

    expect(totals.extraChargePaisa).toBe(2_000);
    expect(totals.codSurchargePaisa).toBe(1_000);
    expect(totals.grandTotalPaisa).toBe(13_000);
  });
});
