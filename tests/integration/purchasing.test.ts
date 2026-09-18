import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from "@/modules/purchasing/service";
import {
  createTestBusiness,
  createTestVariant,
  databaseReachable,
  destroyTestBusiness,
  readBalance,
  type TestContext,
} from "./fixtures";

/**
 * Purchasing flow against the real database: submit, partial receipt with landed
 * costs, idempotent re-submission and cancellation.
 */

const reachable = await databaseReachable();

type ReceiptInput = Parameters<typeof receivePurchaseOrder>[1];
type PurchaseOrderInput = Parameters<typeof createPurchaseOrder>[1];

describe.skipIf(!reachable)("purchasing and goods receipts (database)", () => {
  let context: TestContext;
  const actor = () => ({ userId: context.userId, businessId: context.businessId, actorLabel: "test-buyer" });

  let auction: {
    supplierId: string;
    purchaseOrderId: string;
    firstVariantId: string;
    secondVariantId: string;
    receiptKey: string;
  };

  beforeAll(async () => {
    context = await createTestBusiness("purchasing");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  it("submits a purchase order and tracks incoming stock", async () => {
    const supplier = await createSupplier(actor(), { name: "Dhaka Textiles", isActive: true });
    const first = await createTestVariant(context, { sku: `PO-A-${Date.now()}`, costPaisa: 5_000 });
    const second = await createTestVariant(context, { sku: `PO-B-${Date.now()}`, costPaisa: 8_000 });

    const created = await createPurchaseOrder(actor(), {
      supplierId: supplier.id,
      extraCostPaisa: 50_000,
      items: [
        { variantId: first.variantId, orderedQuantity: 10, unitCostPaisa: 5_000 },
        { variantId: second.variantId, orderedQuantity: 5, unitCostPaisa: 8_000 },
      ],
    } as PurchaseOrderInput);

    expect(created.totalPaisa).toBe(10 * 5_000 + 5 * 8_000 + 50_000);
    expect(created.code).toMatch(/PO-/);

    const draft = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: created.id } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.subtotalPaisa).toBe(90_000);

    await submitPurchaseOrder(actor(), created.id);

    const submitted = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: created.id } });
    expect(submitted.status).toBe("ORDERED");
    expect(submitted.orderedAt).not.toBeNull();

    // Incoming quantity is tracked per balance but never counts as sellable stock.
    const firstBalance = await readBalance(context.locationId, first.variantId);
    expect(firstBalance.incomingQuantity).toBe(10);
    expect(firstBalance.onHand).toBe(0);

    auction = {
      supplierId: supplier.id,
      purchaseOrderId: created.id,
      firstVariantId: first.variantId,
      secondVariantId: second.variantId,
      receiptKey: `receipt-${Date.now()}`,
    };
  });

  it("posts a partial receipt with exact landed costs", async () => {
    const lines = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: auction.purchaseOrderId } });
    const lineA = lines.find((line) => line.variantId === auction.firstVariantId);
    if (!lineA) throw new Error("purchase order line missing");

    const result = await receivePurchaseOrder(actor(), {
      purchaseOrderId: auction.purchaseOrderId,
      idempotencyKey: auction.receiptKey,
      expenses: [{ label: "Clearing agent", amountPaisa: 12_000, allocationMethod: "QUANTITY" }],
      items: [{ purchaseOrderItemId: lineA.id, quantity: 4, unitCostPaisa: 5_000 }],
    } as ReceiptInput);

    expect(result.reused).toBe(false);
    expect(result.status).toBe("PARTIALLY_RECEIVED");
    expect(result.receivedQuantity).toBe(4);

    // Landed value = invoice + this receipt's share of the order's extra cost + clearing.
    // 50,000 spread over 15 ordered units → floor(50,000 × 4 / 15) = 13,333 this time.
    const expectedFreight = Math.floor((50_000 * 4) / 15);
    const expectedLineCost = 4 * 5_000 + expectedFreight + 12_000;
    expect(result.totalCostPaisa).toBe(expectedLineCost);

    const balance = await readBalance(context.locationId, auction.firstVariantId);
    expect(balance.onHand).toBe(4);
    expect(balance.incomingQuantity).toBe(6);
    expect(balance.averageCostPaisa).toBe(Math.floor(expectedLineCost / 4));

    const receiptItem = await prisma.goodsReceiptItem.findFirstOrThrow({ where: { goodsReceiptId: result.receiptId } });
    expect(receiptItem.lineCostPaisa).toBe(expectedLineCost);
    expect(receiptItem.allocatedExpensePaisa).toBe(expectedFreight + 12_000);

    const expenses = await prisma.purchaseExpense.findMany({ where: { purchaseOrderId: auction.purchaseOrderId } });
    expect(expenses.map((expense) => expense.label)).toContain("Clearing agent");

    // The line that was not received keeps its incoming quantity.
    const secondBalance = await readBalance(context.locationId, auction.secondVariantId);
    expect(secondBalance.incomingQuantity).toBe(5);
    expect(secondBalance.onHand).toBe(0);
  });

  it("replays a repeated receipt submission without booking stock twice", async () => {
    const line = await prisma.purchaseOrderItem.findFirstOrThrow({
      where: { purchaseOrderId: auction.purchaseOrderId, variantId: auction.firstVariantId },
    });

    const repeated = await receivePurchaseOrder(actor(), {
      purchaseOrderId: auction.purchaseOrderId,
      idempotencyKey: auction.receiptKey,
      items: [{ purchaseOrderItemId: line.id, quantity: 4, unitCostPaisa: 5_000 }],
    } as ReceiptInput);

    expect(repeated.reused).toBe(true);
    expect((await readBalance(context.locationId, auction.firstVariantId)).onHand).toBe(4);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: auction.purchaseOrderId } })).toBe(1);
  });

  it("refuses to receive more than the outstanding quantity", async () => {
    const line = await prisma.purchaseOrderItem.findFirstOrThrow({
      where: { purchaseOrderId: auction.purchaseOrderId, variantId: auction.firstVariantId },
    });

    await expect(
      receivePurchaseOrder(actor(), {
        purchaseOrderId: auction.purchaseOrderId,
        items: [{ purchaseOrderItemId: line.id, quantity: 99, unitCostPaisa: 5_000 }],
      } as ReceiptInput),
    ).rejects.toThrowError(/outstanding/i);
  });

  it("completes the order when every line is received, capitalising the extra cost exactly once", async () => {
    const lines = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: auction.purchaseOrderId } });
    const lineA = lines.find((line) => line.variantId === auction.firstVariantId);
    const lineB = lines.find((line) => line.variantId === auction.secondVariantId);
    if (!lineA || !lineB) throw new Error("lines missing");

    const result = await receivePurchaseOrder(actor(), {
      purchaseOrderId: auction.purchaseOrderId,
      items: [
        { purchaseOrderItemId: lineA.id, quantity: 6, unitCostPaisa: 5_000 },
        { purchaseOrderItemId: lineB.id, quantity: 5, unitCostPaisa: 8_000 },
      ],
    } as ReceiptInput);

    expect(result.status).toBe("RECEIVED");

    const firstBalance = await readBalance(context.locationId, auction.firstVariantId);
    const secondBalance = await readBalance(context.locationId, auction.secondVariantId);
    expect(firstBalance.onHand).toBe(10);
    expect(firstBalance.incomingQuantity).toBe(0);
    expect(secondBalance.onHand).toBe(5);
    expect(secondBalance.incomingQuantity).toBe(0);

    // The whole order-level extra cost plus the receipt-level expense has been
    // capitalised across receipts exactly once — no double allocation.
    const totals = await prisma.goodsReceiptItem.aggregate({
      where: { goodsReceipt: { purchaseOrderId: auction.purchaseOrderId } },
      _sum: { allocatedExpensePaisa: true },
    });
    expect(totals._sum.allocatedExpensePaisa).toBe(50_000 + 12_000);

    const completed = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: auction.purchaseOrderId } });
    expect(completed.status).toBe("RECEIVED");
    expect(completed.receivedAt).not.toBeNull();
  });

  it("releases incoming stock when an order is cancelled", async () => {
    const variant = await createTestVariant(context, { sku: `PO-CANCEL-${Date.now()}`, costPaisa: 1_500 });

    const created = await createPurchaseOrder(actor(), {
      supplierId: auction.supplierId,
      extraCostPaisa: 0,
      items: [{ variantId: variant.variantId, orderedQuantity: 3, unitCostPaisa: 1_500 }],
    } as PurchaseOrderInput);

    await submitPurchaseOrder(actor(), created.id);
    expect((await readBalance(context.locationId, variant.variantId)).incomingQuantity).toBe(3);

    await cancelPurchaseOrder(actor(), created.id, "Supplier out of stock");

    const cancelled = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: created.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("Supplier out of stock");
    expect((await readBalance(context.locationId, variant.variantId)).incomingQuantity).toBe(0);
  });
});
