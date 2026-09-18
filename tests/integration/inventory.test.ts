import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement, defaultLocationId, recordStockAdjustment } from "@/modules/inventory/service";
import { weightedAverageCostPaisa } from "@/lib/money";
import { createTestBusiness, createTestVariant, databaseReachable, destroyTestBusiness, readBalance, type TestContext } from "./fixtures";

/**
 * Inventory engine, against the real database.
 *
 * These tests prove the two properties the platform depends on:
 *  1. concurrent movements never lose an update (the balance row is locked), and
 *  2. stock can never go negative or be counted twice (idempotency + DB checks).
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("inventory movement engine (database)", () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestBusiness("inventory");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  async function move(variantId: string, input: Parameters<typeof applyStockMovement>[1] extends never ? never : Partial<Parameters<typeof applyStockMovement>[1]>) {
    return withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId,
        type: "OPENING",
        actorUserId: context.userId,
        ...input,
      } as Parameters<typeof applyStockMovement>[1]),
    );
  }

  it("resolves the default location for a business", async () => {
    expect(await defaultLocationId(context.businessId)).toBe(context.locationId);
  });

  it("applies concurrent receipts without losing an update", async () => {
    const { variantId } = await createTestVariant(context, { sku: `CONC-${Date.now()}` });

    const movements = 12;
    await Promise.all(
      Array.from({ length: movements }, () =>
        move(variantId, { onHandDelta: 1, unitCostPaisa: 5_000, type: "PURCHASE_RECEIPT" }),
      ),
    );

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(movements);

    const rows = await prisma.inventoryMovement.count({ where: { variantId } });
    expect(rows).toBe(movements);

    // Every movement wrote the counter as it stood at that moment, and the last
    // one must agree with the balance row.
    const last = await prisma.inventoryMovement.findFirst({ where: { variantId }, orderBy: { createdAt: "desc" } });
    expect(last?.onHandAfter).toBe(movements);
  });

  it("never lets concurrent dispatches push stock below zero", async () => {
    const { variantId } = await createTestVariant(context, { sku: `OVERSELL-${Date.now()}` });
    await move(variantId, { onHandDelta: 5, unitCostPaisa: 4_000, type: "PURCHASE_RECEIPT" });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        move(variantId, { onHandDelta: -1, type: "ADJUSTMENT_DECREASE" }),
      ),
    );

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.filter((result) => result.status === "rejected").length;

    expect(succeeded).toBe(5);
    expect(failed).toBe(5);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(0);
    expect(balance.onHand).toBeGreaterThanOrEqual(0);
  });

  it("replays an idempotency key instead of moving stock twice", async () => {
    const { variantId } = await createTestVariant(context, { sku: `IDEM-${Date.now()}` });
    const key = `receipt-${Date.now()}`;

    const first = await move(variantId, { onHandDelta: 3, unitCostPaisa: 2_500, idempotencyKey: key, type: "PURCHASE_RECEIPT" });
    const second = await move(variantId, { onHandDelta: 3, unitCostPaisa: 2_500, idempotencyKey: key, type: "PURCHASE_RECEIPT" });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.movementId).toBe(first.movementId);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(3);
  });

  it("keeps the weighted average cost exact across receipts at different costs", async () => {
    const { variantId } = await createTestVariant(context, { sku: `WAC-${Date.now()}` });

    await move(variantId, { onHandDelta: 10, unitCostPaisa: 10_000, type: "PURCHASE_RECEIPT" });
    await move(variantId, { onHandDelta: 10, unitCostPaisa: 15_000, type: "PURCHASE_RECEIPT" });

    const balance = await readBalance(context.locationId, variantId);
    const expected = weightedAverageCostPaisa({
      oldQuantity: 10,
      oldAverageCostPaisa: 10_000,
      receivedQuantity: 10,
      receivedUnitCostPaisa: 15_000,
    });
    expect(expected).toBe(12_500);
    expect(balance.averageCostPaisa).toBe(expected);
    expect(balance.onHand).toBe(20);

    // Dispatching stock must not change the average cost.
    await move(variantId, { onHandDelta: -4, type: "SALE_DISPATCH" });
    const afterDispatch = await readBalance(context.locationId, variantId);
    expect(afterDispatch.averageCostPaisa).toBe(12_500);
    expect(afterDispatch.onHand).toBe(16);
  });

  it("holds damaged and inspection stock outside the sellable pool", async () => {
    const { variantId } = await createTestVariant(context, { sku: `COND-${Date.now()}` });
    await move(variantId, { onHandDelta: 10, unitCostPaisa: 1_000, type: "PURCHASE_RECEIPT" });
    await move(variantId, { damagedDelta: 2, type: "DAMAGE_RECORDED" });
    await move(variantId, { inspectionDelta: 1, type: "INSPECTION_IN" });

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(10);
    expect(balance.damaged).toBe(2);
    expect(balance.inspection).toBe(1);
    expect(balance.onHand - balance.reserved - balance.damaged - balance.inspection).toBe(7);

    // Requesting more sellable stock than is available must fail.
    await expect(move(variantId, { onHandDelta: -8, type: "SALE_DISPATCH" })).rejects.toThrowError(/available/i);
  });

  it("records an audited adjustment with a reason code", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ADJ-${Date.now()}` });

    const result = await recordStockAdjustment({
      businessId: context.businessId,
      locationId: context.locationId,
      variantId,
      direction: "INCREASE",
      condition: "SELLABLE",
      quantity: 7,
      reasonCode: "STOCK_COUNT",
      actorUserId: context.userId,
    });

    expect(result.reused).toBe(false);
    expect(result.balance.onHand).toBe(7);

    const adjustment = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: result.adjustmentId } });
    expect(adjustment.quantity).toBe(7);
    expect(adjustment.reasonCode).toBe("STOCK_COUNT");
    expect(adjustment.inventoryMovementId).toBe(result.movementId);

    const audit = await prisma.auditLog.findFirst({
      where: { businessId: context.businessId, action: "inventory.adjusted", entityId: variantId },
    });
    expect(audit).not.toBeNull();

    // A reason that requires a note must reject a note-less adjustment.
    await expect(
      recordStockAdjustment({
        businessId: context.businessId,
        locationId: context.locationId,
        variantId,
        direction: "DECREASE",
        condition: "SELLABLE",
        quantity: 1,
        reasonCode: "DAMAGE",
        actorUserId: context.userId,
      }),
    ).rejects.toThrowError(/note/i);
  });
});
