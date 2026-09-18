import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  clampPaisa,
  discountFromBps,
  formatPaisa,
  grossProfitPaisa,
  lineTotalPaisa,
  marginBps,
  parseAmountToPaisa,
  paisaToMajorUnits,
  percentagePaisa,
  roundToMajorUnit,
  sumPaisa,
  weightedAverageCostPaisa,
} from "@/lib/money";

/**
 * Money is stored as an integer number of paisa (1 BDT = 100 paisa). These
 * tests pin the rounding behaviour, because every invoice, COD settlement and
 * reseller ledger entry depends on it staying exact.
 */
describe("money", () => {
  it("sums integer paisa without floating point drift", () => {
    expect(sumPaisa(1250, 3799, 1)).toBe(5050);
    expect(sumPaisa()).toBe(0);
  });

  it("computes line totals as integers", () => {
    expect(lineTotalPaisa(1250, 3)).toBe(3750);
    expect(lineTotalPaisa(999, 0)).toBe(0);
  });

  it("converts basis points with half-up rounding", () => {
    // 10% of 1234.567... is 123.4567 -> 123
    expect(percentagePaisa(1234, 1000)).toBe(123);
    // 2.5% of 10.00 BDT (1000 paisa) is exactly 25 paisa
    expect(percentagePaisa(1000, 250)).toBe(25);
    // half cases round up
    expect(percentagePaisa(5, 1000)).toBe(1);
    expect(percentagePaisa(4, 1000)).toBe(0);
  });

  it("rounds to the nearest major unit", () => {
    expect(roundToMajorUnit(4999)).toBe(5000);
    expect(roundToMajorUnit(4949)).toBe(4900);
  });

  it("allocates proportionally without losing or inventing a paisa", () => {
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(sumPaisa(...parts)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);

    const weighted = allocateProportionally(10001, [3, 1]);
    expect(sumPaisa(...weighted)).toBe(10001);
    expect(weighted).toEqual([7501, 2500]);
  });

  it("handles zero total or zero weights", () => {
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportionally(500, [0, 0])).toEqual([250, 250]);
  });

  it("calculates weighted average cost", () => {
    // 10 units at 100.00 + 5 units at 130.00 = 1650.00 over 15 units = 110.00
    const cost = weightedAverageCostPaisa({
      oldQuantity: 10,
      oldAverageCostPaisa: 10_000,
      receivedQuantity: 5,
      receivedUnitCostPaisa: 13_000,
    });
    expect(cost).toBe(11_000);
  });

  it("uses the received cost when there is no stock on hand", () => {
    const cost = weightedAverageCostPaisa({
      oldQuantity: 0,
      oldAverageCostPaisa: 0,
      receivedQuantity: 4,
      receivedUnitCostPaisa: 2_000,
    });
    expect(cost).toBe(2_000);
  });

  it("is exact for values beyond float precision", () => {
    const cost = weightedAverageCostPaisa({
      oldQuantity: 1_000_000,
      oldAverageCostPaisa: 123_456_789,
      receivedQuantity: 1,
      receivedUnitCostPaisa: 1,
    });
    const expected = Number(
      (BigInt(1_000_000) * BigInt(123_456_789) + BigInt(1) * BigInt(1) + BigInt(500_000)) / BigInt(1_000_001),
    );
    expect(Number.isInteger(cost)).toBe(true);
    expect(cost).toBe(expected);
  });

  it("parses user input into paisa", () => {
    expect(parseAmountToPaisa("1250")).toBe(125_000);
    expect(parseAmountToPaisa("1250.50")).toBe(125_050);
    expect(parseAmountToPaisa("1,250.5")).toBe(125_050);
    expect(parseAmountToPaisa("৳1,250.55")).toBe(125_055);
    expect(parseAmountToPaisa("1250.5")).toBe(125_050);
    expect(parseAmountToPaisa(-1250)).toBe(-125_000);
    expect(() => parseAmountToPaisa("")).toThrow();
    expect(() => parseAmountToPaisa("12.345")).toThrow();
    expect(() => parseAmountToPaisa("abc")).toThrow();
  });

  it("formats paisa for display in BDT", () => {
    expect(formatPaisa(125_050)).toMatch(/1,250\.50$/);
    expect(formatPaisa(0)).toMatch(/0\.00$/);
  });

  it("converts paisa to major units", () => {
    expect(paisaToMajorUnits(125_050)).toBe(1250.5);
  });

  it("applies discounts and computes profit and margin", () => {
    expect(discountFromBps(10_000, 1500)).toBe(1500);
    expect(grossProfitPaisa(10_000, 6500)).toBe(3500);
    expect(marginBps(10_000, 6500)).toBe(3500);
    expect(marginBps(0, 100)).toBe(0);
  });

  it("clamps negative values", () => {
    expect(clampPaisa(-50)).toBe(0);
    expect(clampPaisa(50)).toBe(50);
    expect(clampPaisa(200, 0, 100)).toBe(100);
  });
});
