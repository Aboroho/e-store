import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { allocateProportionally } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { applyStockMovement, defaultLocationId } from "@/modules/inventory/service";
import type { GoodsReceiptInput, PurchaseOrderInput, SupplierInput } from "@/modules/catalog/schemas";

/**
 * Purchasing.
 *
 * The only place stock enters the system other than positive adjustments.
 * Receiving is idempotent (a submitted receipt carries a key), updates the
 * weighted average cost atomically with the stock movement, and allocates
 * additional acquisition costs (transport, duty, …) across the received lines.
 */

export interface PurchasingActor {
  userId: string;
  businessId: string;
  actorLabel: string;
}

export async function createSupplier(actor: PurchasingActor, input: SupplierInput) {
  return withTransaction(async (tx) => {
    const existing = await tx.supplier.findFirst({
      where: { businessId: actor.businessId, name: input.name },
      select: { id: true },
    });
    if (existing) throw AppError.conflict("A supplier with that name already exists");

    const supplier = await tx.supplier.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        note: input.note ?? null,
        paymentTerms: input.paymentTerms ?? null,
        isActive: input.isActive,
      },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "supplier.created",
        entityType: "Supplier",
        entityId: supplier.id,
        summary: `Created supplier ${supplier.name}`,
      },
    });
    return supplier;
  });
}

export async function updateSupplier(actor: PurchasingActor, supplierId: string, input: Partial<SupplierInput>) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, businessId: actor.businessId } });
  if (!supplier) throw AppError.notFound("Supplier not found");
  return prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: input.name ?? undefined,
      contactName: input.contactName !== undefined ? input.contactName ?? null : undefined,
      phone: input.phone !== undefined ? input.phone ?? null : undefined,
      email: input.email !== undefined ? input.email ?? null : undefined,
      address: input.address !== undefined ? input.address ?? null : undefined,
      note: input.note !== undefined ? input.note ?? null : undefined,
      paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms ?? null : undefined,
      isActive: input.isActive ?? undefined,
    },
  });
}

export async function createPurchaseOrder(actor: PurchasingActor, input: PurchaseOrderInput) {
  return withTransaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, businessId: actor.businessId, isActive: true },
      select: { id: true, name: true },
    });
    if (!supplier) throw AppError.validation("Select an active supplier");

    const variantIds = input.items.map((item) => item.variantId);
    const variants = await tx.variant.findMany({
      where: { id: { in: variantIds }, product: { businessId: actor.businessId } },
      select: { id: true, sku: true, name: true, costPaisa: true, product: { select: { name: true } } },
    });
    if (variants.length !== new Set(variantIds).size) {
      throw AppError.validation("One or more variants do not exist");
    }
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    const seen = new Set<string>();
    for (const item of input.items) {
      if (seen.has(item.variantId)) throw AppError.validation("The same variant appears twice in the purchase order");
      seen.add(item.variantId);
    }

    const code = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "purchase_order" });
    const subtotalPaisa = input.items.reduce((total, item) => total + item.unitCostPaisa * item.orderedQuantity, 0);

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        businessId: actor.businessId,
        supplierId: input.supplierId,
        code,
        status: "DRAFT",
        expectedAt: input.expectedAt ?? null,
        note: input.note ?? null,
        internalNote: input.internalNote ?? null,
        extraCostPaisa: input.extraCostPaisa,
        subtotalPaisa,
        totalPaisa: subtotalPaisa + input.extraCostPaisa,
        createdByUserId: actor.userId,
        items: {
          create: input.items.map((item, index) => {
            const variant = variantById.get(item.variantId)!;
            return {
              variantId: item.variantId,
              sku: variant.sku,
              productName: variant.product.name,
              variantName: variant.name,
              orderedQuantity: item.orderedQuantity,
              unitCostPaisa: item.unitCostPaisa,
              lineTotalPaisa: item.unitCostPaisa * item.orderedQuantity,
              position: index,
              note: item.note ?? null,
            };
          }),
        },
      },
      select: { id: true, code: true, totalPaisa: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "purchase_order.created",
        entityType: "PurchaseOrder",
        entityId: purchaseOrder.id,
        summary: `Created purchase order ${purchaseOrder.code} for ${supplier.name}`,
        after: { code: purchaseOrder.code, items: input.items.length, totalPaisa: purchaseOrder.totalPaisa },
      },
    });

    return purchaseOrder;
  });
}

/** Move a draft purchase order to ORDERED and mark the stock as incoming. */
export async function submitPurchaseOrder(actor: PurchasingActor, purchaseOrderId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!po) throw AppError.notFound("Purchase order not found");
    if (po.status !== "DRAFT") throw AppError.invalidState("Only draft purchase orders can be submitted");

    const locationId = await defaultLocationId(actor.businessId);
    for (const item of po.items) {
      await applyStockMovement(tx, {
        businessId: actor.businessId,
        locationId,
        variantId: item.variantId,
        type: "CORRECTION",
        incomingDelta: item.orderedQuantity,
        sourceType: "PurchaseOrder",
        sourceId: po.id,
        reference: po.code,
        reason: "purchase_order_submitted",
        actorUserId: actor.userId,
      });
    }

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "ORDERED", orderedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "purchase_order.submitted",
        entityType: "PurchaseOrder",
        entityId: po.id,
        summary: `Submitted purchase order ${po.code}`,
        before: { status: po.status },
        after: { status: "ORDERED" },
      },
    });
  });
}

export async function cancelPurchaseOrder(actor: PurchasingActor, purchaseOrderId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw AppError.validation("Give a reason for cancelling the purchase order");

  await withTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!po) throw AppError.notFound("Purchase order not found");
    if (po.status === "RECEIVED") throw AppError.invalidState("A fully received purchase order cannot be cancelled");
    if (po.status === "CANCELLED") throw AppError.invalidState("This purchase order is already cancelled");

    if (po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED") {
      const locationId = await defaultLocationId(actor.businessId);
      for (const item of po.items) {
        const outstanding = item.orderedQuantity - item.receivedQuantity;
        if (outstanding <= 0) continue;
        await applyStockMovement(tx, {
          businessId: actor.businessId,
          locationId,
          variantId: item.variantId,
          type: "CORRECTION",
          incomingDelta: -outstanding,
          sourceType: "PurchaseOrder",
          sourceId: po.id,
          reference: po.code,
          reason: "purchase_order_cancelled",
          actorUserId: actor.userId,
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "purchase_order.cancelled",
        entityType: "PurchaseOrder",
        entityId: po.id,
        summary: `Cancelled purchase order ${po.code}`,
        reason,
        before: { status: po.status },
        after: { status: "CANCELLED" },
      },
    });
  });
}

export interface ReceivePurchaseOrderResult {
  receiptId: string;
  code: string;
  reused: boolean;
  receivedQuantity: number;
  totalCostPaisa: number;
  status: PurchaseStatusName;
}

type PurchaseStatusName = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

/**
 * Receive (part of) a purchase order.
 *
 * Runs in one transaction: stock movements, weighted average cost, receipt
 * document, purchase order status and the audit trail all commit together or
 * not at all. A repeated submit with the same idempotency key returns the
 * original receipt instead of booking the stock twice.
 */
export async function receivePurchaseOrder(
  actor: PurchasingActor,
  input: GoodsReceiptInput,
): Promise<ReceivePurchaseOrderResult> {
  return withTransaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, businessId: actor.businessId },
      include: { items: true, supplier: { select: { name: true } } },
    });
    if (!po) throw AppError.notFound("Purchase order not found");
    if (po.status === "DRAFT") throw AppError.invalidState("Submit the purchase order before receiving it");
    if (po.status === "CANCELLED") throw AppError.invalidState("This purchase order is cancelled");

    if (input.idempotencyKey) {
      const existing = await tx.goodsReceipt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { items: true },
      });
      if (existing) {
        return {
          receiptId: existing.id,
          code: existing.code,
          reused: true,
          receivedQuantity: existing.totalQuantity,
          totalCostPaisa: existing.totalCostPaisa,
          status: po.status as PurchaseStatusName,
        };
      }
    }

    const locationId = input.locationId ?? (await defaultLocationId(actor.businessId));
    const location = await tx.inventoryLocation.findFirst({
      where: { id: locationId, businessId: actor.businessId, isActive: true },
      select: { id: true },
    });
    if (!location) throw AppError.validation("Select an active inventory location");

    const itemById = new Map(po.items.map((item) => [item.id, item]));
    const requested = input.items.filter((item) => item.quantity > 0);
    if (requested.length === 0) throw AppError.validation("Enter the received quantity for at least one line");

    for (const row of requested) {
      const item = itemById.get(row.purchaseOrderItemId);
      if (!item) throw AppError.validation("That line does not belong to this purchase order");
      const outstanding = item.orderedQuantity - item.receivedQuantity;
      if (row.quantity > outstanding) {
        throw AppError.validation(
          `${item.sku}: only ${outstanding} unit(s) are outstanding on a line of ${item.orderedQuantity}`,
        );
      }
    }

    const receiptCode = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "goods_receipt" });
    const totalQuantity = requested.reduce((total, row) => total + row.quantity, 0);

    // The purchase order's extra cost (freight, duty) belongs to the whole order.
    // Only the share that matches the quantity received so far is capitalised on
    // this receipt, otherwise a two-part delivery would capitalise it twice.
    const orderedQuantity = po.items.reduce((total, item) => total + item.orderedQuantity, 0);
    const receivedBefore = po.items.reduce((total, item) => total + item.receivedQuantity, 0);
    const shareBefore =
      orderedQuantity > 0 ? Math.floor((po.extraCostPaisa * receivedBefore) / orderedQuantity) : 0;
    const shareAfter =
      orderedQuantity > 0 ? Math.floor((po.extraCostPaisa * (receivedBefore + totalQuantity)) / orderedQuantity) : 0;
    const extraCostForThisReceipt = Math.max(shareAfter - shareBefore, 0);

    const expenses = [
      ...(extraCostForThisReceipt > 0
        ? [
            {
              label: `Purchase order ${po.code} additional costs`,
              amountPaisa: extraCostForThisReceipt,
              allocationMethod: "VALUE" as const,
            },
          ]
        : []),
      ...(input.expenses ?? []),
    ];
    const allocationsByItem = new Map<string, number>();
    for (const row of requested) allocationsByItem.set(row.purchaseOrderItemId, 0);

    for (const expense of expenses) {
      if (expense.amountPaisa <= 0) continue;
      if (expense.allocationMethod === "NONE") {
        // Recorded as a purchase expense but not capitalised into stock value.
        continue;
      }
      const weights =
        expense.allocationMethod === "QUANTITY"
          ? requested.map((row) => row.quantity)
          : requested.map((row) => row.quantity * row.unitCostPaisa);
      const shares = allocateProportionally(expense.amountPaisa, weights);
      requested.forEach((row, index) => {
        allocationsByItem.set(row.purchaseOrderItemId, (allocationsByItem.get(row.purchaseOrderItemId) ?? 0) + (shares[index] ?? 0));
      });
    }

    const receipt = await tx.goodsReceipt.create({
      data: {
        purchaseOrderId: po.id,
        code: receiptCode,
        status: "POSTED",
        receivedByUserId: actor.userId,
        locationId,
        idempotencyKey: input.idempotencyKey ?? null,
        note: input.note ?? null,
        externalReference: input.externalReference ?? null,
        totalQuantity,
        totalCostPaisa: 0,
      },
      select: { id: true },
    });

    let totalCostPaisa = 0;

    for (const row of requested) {
      const item = itemById.get(row.purchaseOrderItemId)!;
      const allocatedExpensePaisa = allocationsByItem.get(row.purchaseOrderItemId) ?? 0;
      // The received value is exact: invoice price plus the allocated share of
      // freight and duties. The unit cost handed to the weighted average is
      // floored to whole paisa (money is never stored as a float); the sub-paisa
      // residue stays visible in `lineCostPaisa`, which is the authoritative
      // receipt value used for supplier payables.
      const lineCostPaisa = row.quantity * row.unitCostPaisa + allocatedExpensePaisa;
      const effectiveUnitCostPaisa = Math.floor(lineCostPaisa / row.quantity);

      const movement = await applyStockMovement(tx, {
        businessId: actor.businessId,
        locationId,
        variantId: item.variantId,
        type: "PURCHASE_RECEIPT",
        onHandDelta: row.quantity,
        incomingDelta: -row.quantity,
        unitCostPaisa: effectiveUnitCostPaisa,
        sourceType: "GoodsReceipt",
        sourceId: receipt.id,
        reference: `${po.code}/${receiptCode}`,
        actorUserId: actor.userId,
        note: input.note ?? null,
      });

      await tx.goodsReceiptItem.create({
        data: {
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: item.id,
          variantId: item.variantId,
          quantity: row.quantity,
          unitCostPaisa: row.unitCostPaisa,
          allocatedExpensePaisa,
          lineCostPaisa,
          inventoryMovementId: movement.movementId,
        },
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQuantity: item.receivedQuantity + row.quantity },
      });

      totalCostPaisa += lineCostPaisa;
    }

    await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { totalCostPaisa } });

    for (const expense of input.expenses ?? []) {
      await tx.purchaseExpense.create({
        data: {
          purchaseOrderId: po.id,
          goodsReceiptId: receipt.id,
          label: expense.label,
          amountPaisa: expense.amountPaisa,
          allocationMethod: expense.allocationMethod,
          allocated: expense.allocationMethod !== "NONE",
          createdByUserId: actor.userId,
        },
      });
    }

    const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, select: { orderedQuantity: true, receivedQuantity: true } });
    const fullyReceived = items.every((item) => item.receivedQuantity >= item.orderedQuantity);
    const status: PurchaseStatusName = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status, receivedAt: fullyReceived ? new Date() : po.receivedAt },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "purchase_order.received",
        entityType: "PurchaseOrder",
        entityId: po.id,
        summary: `Received ${totalQuantity} unit(s) against ${po.code} (receipt ${receiptCode})`,
        before: { status: po.status },
        after: { status, totalQuantity, totalCostPaisa },
        changedFields: ["stock", "averageCostPaisa"],
      },
    });

    return { receiptId: receipt.id, code: receiptCode, reused: false, receivedQuantity: totalQuantity, totalCostPaisa, status };
  });
}

export async function recordSupplierPayment(
  actor: PurchasingActor,
  input: {
    supplierId: string;
    purchaseOrderId?: string;
    amountPaisa: number;
    method: string;
    reference?: string;
    note?: string;
    paidAt?: Date;
  },
) {
  return withTransaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: actor.businessId } });
    if (!supplier) throw AppError.notFound("Supplier not found");

    if (input.purchaseOrderId) {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: input.purchaseOrderId, businessId: actor.businessId },
        select: { id: true, code: true, paidPaisa: true, totalPaisa: true, supplierId: true },
      });
      if (!po) throw AppError.notFound("Purchase order not found");
      if (po.supplierId !== input.supplierId) throw AppError.validation("That purchase order belongs to a different supplier");

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { paidPaisa: po.paidPaisa + input.amountPaisa },
      });
    }

    const payment = await tx.supplierPayment.create({
      data: {
        businessId: actor.businessId,
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        amountPaisa: input.amountPaisa,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        paidAt: input.paidAt ?? new Date(),
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "supplier.payment_recorded",
        entityType: "Supplier",
        entityId: input.supplierId,
        summary: `Recorded supplier payment of ${input.amountPaisa} paisa`,
        after: { amountPaisa: input.amountPaisa, method: input.method, purchaseOrderId: input.purchaseOrderId ?? null },
      },
    });

    return payment;
  });
}

export const purchasingPrisma: Prisma.TransactionClient | typeof prisma = prisma;
