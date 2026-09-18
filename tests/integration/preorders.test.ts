import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement, availableQuantity } from "@/modules/inventory/service";
import {
  allocatePreorderQueue,
  allocatePreorders,
  cancelPreorderCommitment,
  createPreorderCommitment,
} from "@/modules/preorders/service";
import { createTestBusiness, createTestOrderLine, createTestVariant, databaseReachable, destroyTestBusiness, readBalance, type TestContext } from "./fixtures";

/**
 * Preorder queue against the real database.
 *
 * The important guarantees: commitments never count as stock, allocation always
 * serves the oldest commitment first, the committed counter is released when a
 * commitment is cancelled, and allocation can never conjure stock that is not
 * physically on hand.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("preorder queue (database)", () => {
  let context: TestContext;
  const actor = () => ({ userId: context.userId, businessId: context.businessId, actorLabel: "test-support" });

  beforeAll(async () => {
    context = await createTestBusiness("preorders");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  it("tracks commitments without touching on-hand stock", async () => {
    const variant = await createTestVariant(context, { sku: `PRE-${Date.now()}` });
    const orderLine = await createTestOrderLine(context, variant.variantId, 3);

    const commitment = await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: orderLine.orderId,
        orderItemId: orderLine.orderItemId,
        quantity: 3,
        createdByUserId: context.userId,
      }),
    );

    expect(commitment.status).toBe("OPEN");
    expect(commitment.quantity).toBe(3);

    const balance = await readBalance(context.locationId, variant.variantId);
    expect(balance.preorderCommitted).toBe(3);
    expect(balance.onHand).toBe(0);
    expect(balance.reserved).toBe(0);
    expect(availableQuantity(balance)).toBe(0);

    // Creating a commitment for the same order line again extends it (idempotent).
    const extended = await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: orderLine.orderId,
        orderItemId: orderLine.orderItemId,
        quantity: 1,
        createdByUserId: context.userId,
      }),
    );
    expect(extended.quantity).toBe(4);
    expect((await readBalance(context.locationId, variant.variantId)).preorderCommitted).toBe(4);
  });

  it("allocates received stock to the oldest commitment first", async () => {
    const variant = await createTestVariant(context, { sku: `FIFO-${Date.now()}` });
    const older = await createTestOrderLine(context, variant.variantId, 2);
    const newer = await createTestOrderLine(context, variant.variantId, 2);

    const firstCommitment = await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: older.orderId,
        orderItemId: older.orderItemId,
        quantity: 2,
        createdByUserId: context.userId,
      }),
    );
    // Guarantee a strict FIFO order regardless of how fast the fixture ran.
    await prisma.preorderCommitment.update({
      where: { id: firstCommitment.id },
      data: { priorityAt: new Date(Date.now() - 60_000) },
    });
    const secondCommitment = await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: newer.orderId,
        orderItemId: newer.orderItemId,
        quantity: 2,
        createdByUserId: context.userId,
      }),
    );

    // Two units arrive.
    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        type: "PURCHASE_RECEIPT",
        onHandDelta: 2,
        unitCostPaisa: 4_000,
        actorUserId: context.userId,
      }),
    );

    const allocation = await allocatePreorderQueue(actor(), {
      variantId: variant.variantId,
      locationId: context.locationId,
      quantity: 2,
    });

    expect(allocation.allocated).toBe(2);
    expect(allocation.commitments).toHaveLength(1);
    expect(allocation.commitments[0]?.commitmentId).toBe(firstCommitment.id);
    expect(allocation.commitments[0]?.status).toBe("ALLOCATED");

    const balances = await readBalance(context.locationId, variant.variantId);
    expect(balances.onHand).toBe(2);
    expect(balances.reserved).toBe(2);
    expect(balances.preorderCommitted).toBe(2);
    expect(availableQuantity(balances)).toBe(0);

    const olderRow = await prisma.preorderCommitment.findUniqueOrThrow({ where: { id: firstCommitment.id } });
    const newerRow = await prisma.preorderCommitment.findUniqueOrThrow({ where: { id: secondCommitment.id } });
    expect(olderRow.allocatedQuantity).toBe(2);
    expect(olderRow.status).toBe("ALLOCATED");
    expect(newerRow.allocatedQuantity).toBe(0);
    expect(newerRow.status).toBe("OPEN");

    // One more unit arrives; the younger commitment gets it.
    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        type: "PURCHASE_RECEIPT",
        onHandDelta: 1,
        unitCostPaisa: 4_000,
        actorUserId: context.userId,
      }),
    );

    const partial = await allocatePreorderQueue(actor(), {
      variantId: variant.variantId,
      locationId: context.locationId,
      quantity: 1,
    });
    expect(partial.allocated).toBe(1);
    expect(partial.commitments[0]?.commitmentId).toBe(secondCommitment.id);

    const newerAfter = await prisma.preorderCommitment.findUniqueOrThrow({ where: { id: secondCommitment.id } });
    expect(newerAfter.allocatedQuantity).toBe(1);
    expect(newerAfter.status).toBe("PARTIALLY_ALLOCATED");

    // Nothing is left on the shelf (3 on hand, 3 reserved), so asking for five
    // more units allocates nothing and reports the whole request as skipped
    // instead of throwing or reserving stock that is not there.
    const shortfall = await allocatePreorderQueue(actor(), {
      variantId: variant.variantId,
      locationId: context.locationId,
      quantity: 5,
    });
    expect(shortfall.allocated).toBe(0);
    expect(shortfall.skipped).toBe(5);

    const finalBalance = await readBalance(context.locationId, variant.variantId);
    expect(finalBalance.reserved).toBe(3);
    expect(availableQuantity(finalBalance)).toBe(0);
  });

  it("never allocates stock that is not physically present", async () => {
    const variant = await createTestVariant(context, { sku: `NOSock-${Date.now()}` });
    const orderLine = await createTestOrderLine(context, variant.variantId, 2);

    await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: orderLine.orderId,
        orderItemId: orderLine.orderItemId,
        quantity: 2,
        createdByUserId: context.userId,
      }),
    );

    await expect(
      withTransaction((tx) =>
        allocatePreorders(tx, {
          businessId: context.businessId,
          locationId: context.locationId,
          variantId: variant.variantId,
          quantity: 2,
          actorUserId: context.userId,
        }),
      ),
    ).rejects.toThrowError(/available/i);

    const balance = await readBalance(context.locationId, variant.variantId);
    expect(balance.reserved).toBe(0);
    expect(balance.preorderCommitted).toBe(2);
  });

  it("releases committed and reserved stock when a commitment is cancelled", async () => {
    const variant = await createTestVariant(context, { sku: `CANCEL-${Date.now()}` });
    const orderLine = await createTestOrderLine(context, variant.variantId, 2);

    const commitment = await withTransaction((tx) =>
      createPreorderCommitment(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        orderId: orderLine.orderId,
        orderItemId: orderLine.orderItemId,
        quantity: 2,
        createdByUserId: context.userId,
      }),
    );

    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        type: "PURCHASE_RECEIPT",
        onHandDelta: 2,
        unitCostPaisa: 3_000,
        actorUserId: context.userId,
      }),
    );
    await allocatePreorderQueue(actor(), { variantId: variant.variantId, locationId: context.locationId, quantity: 2 });

    expect((await readBalance(context.locationId, variant.variantId)).reserved).toBe(2);

    await cancelPreorderCommitment(actor(), commitment.id, "Customer cancelled the preorder");

    const balance = await readBalance(context.locationId, variant.variantId);
    expect(balance.reserved).toBe(0);
    expect(balance.preorderCommitted).toBe(0);
    expect(availableQuantity(balance)).toBe(2);

    const cancelled = await prisma.preorderCommitment.findUniqueOrThrow({ where: { id: commitment.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("Customer cancelled the preorder");
    expect(cancelled.cancelledAt).not.toBeNull();
  });
});
