import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getBusinessSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { applyStockMovement, defaultLocationId } from "@/modules/inventory/service";
import { recordResellerEarnings, reconcilePayoutAfterVoid, voidResellerEarnings } from "@/modules/resellers/earnings";
import { statusGroupOf, type InternalOrderStatus } from "@/modules/orders/status";

/**
 * Courier outcomes applied to an order.
 *
 * One shared implementation for every way a delivery can end — a webhook, a
 * polling sync, a manual "refresh tracking" click — so the order status, the
 * stock ledger and the reseller ledger always move together. The functions take a
 * transaction client: the caller (courier service) owns the transaction that also
 * stores the provider event, which is what makes repeated webhooks idempotent.
 */

type Tx = Prisma.TransactionClient;

export type CourierOutcome = "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED" | "CANCELLED";

/**
 * Put the units that came back into stock.
 *
 * Where they land follows the business setting `exchange.restock_requires_inspection`:
 * with inspection on (the default) returned units sit in the inspection counter
 * until somebody checks them, otherwise they go straight back to sellable stock.
 * Every line is guarded by an idempotency key, so a replayed webhook never
 * restocks twice.
 */
export async function restockReturnedUnits(
  tx: Tx,
  input: {
    businessId: string;
    order: { id: string; orderNumber: string };
    items: Array<{
      id: string;
      variantId: string | null;
      dispatchedQuantity: number;
      returnedQuantity: number;
      exchangedQuantity: number;
      unitCostPaisa: number;
    }>;
    reason: string;
    note?: string | null;
    actorUserId?: string | null;
    /** Prefix that keeps the idempotency key distinct per outcome. */
    keyPrefix: string;
    inspectReturns?: boolean;
  },
): Promise<{ restockedUnits: number; inspectReturns: boolean }> {
  const inspectReturns =
    input.inspectReturns ?? Boolean((await getBusinessSettings(input.businessId))["exchange.restock_requires_inspection"] ?? true);
  const locationId = await defaultLocationId(input.businessId);
  let restockedUnits = 0;

  for (const item of input.items) {
    const outstanding = Math.max(0, item.dispatchedQuantity - item.returnedQuantity - item.exchangedQuantity);
    if (outstanding <= 0 || !item.variantId) continue;

    const key = `order:${input.order.id}:${input.keyPrefix}:${item.id}`;
    const existing = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: key } });
    if (!existing) {
      await applyStockMovement(tx, {
        businessId: input.businessId,
        locationId,
        variantId: item.variantId,
        type: inspectReturns ? "INSPECTION_IN" : "SALE_REVERSAL",
        ...(inspectReturns ? { inspectionDelta: outstanding } : { onHandDelta: outstanding }),
        unitCostPaisa: item.unitCostPaisa || null,
        sourceType: "Order",
        sourceId: input.order.id,
        reference: input.order.orderNumber,
        reason: input.reason,
        note: input.note ?? null,
        actorUserId: input.actorUserId ?? null,
        idempotencyKey: key,
      });
      restockedUnits += outstanding;
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: { returnedQuantity: item.returnedQuantity + (existing ? 0 : outstanding), status: "CANCELLED" },
    });
  }

  return { restockedUnits, inspectReturns };
}

export interface CourierOutcomeResult {
  orderStatusChanged: boolean;
  fromStatus: string | null;
  toStatus: string | null;
  restockedUnits: number;
  earningsRecorded: boolean;
  earningsVoided: boolean;
}

/**
 * Mirror a courier outcome onto the order, its stock and the reseller ledger.
 *
 *  - DELIVERED: the order becomes Delivered and the reseller earning is recorded
 *    (still *pending* until the COD settlement is reconciled — see
 *    docs/BUSINESS_RULES.md → "Reseller earnings");
 *  - PARTIALLY_DELIVERED: the order becomes Partially Delivered; no earning is
 *    recorded yet because the outcome is not final. An operator records the
 *    delivered/returned quantities per line to finish it;
 *  - RETURNED: dispatched units go back to inspection (or to sellable stock),
 *    the order becomes Returned and any reseller earning is voided, re-costing a
 *    payout that already contained it;
 *  - CANCELLED (by the courier): fulfilment is cancelled and the reserved units
 *    are released by the cancellation workflow, not here.
 *
 * An order a person already moved past the courier stage is never dragged
 * backwards: a Completed or Cancelled order keeps its status.
 */
export async function applyCourierOutcome(
  tx: Tx,
  input: {
    businessId: string;
    orderId: string;
    shipmentId: string;
    shipmentReference: string;
    outcome: CourierOutcome;
    providerStatusRaw?: string | null;
    courierEventId?: string | null;
    note?: string | null;
    actorUserId?: string | null;
    collectedPaisa?: number | null;
  },
): Promise<CourierOutcomeResult> {
  const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
  if (!order) {
    return {
      orderStatusChanged: false,
      fromStatus: null,
      toStatus: null,
      restockedUnits: 0,
      earningsRecorded: false,
      earningsVoided: false,
    };
  }

  const current = order.status as InternalOrderStatus;
  const patch: Prisma.OrderUpdateInput = {};
  let toStatus: string | null = null;
  let restockedUnits = 0;
  let earningsRecorded = false;
  let earningsVoided = false;

  const alreadyFinal = current === "COMPLETED" || current === "CANCELLED";
  const alreadyDelivered = current === "DELIVERED" || current === "COMPLETED";

  if (input.outcome === "DELIVERED" && !alreadyDelivered && !alreadyFinal) {
    patch.status = "DELIVERED";
    patch.deliveredAt = new Date();
    patch.fulfillmentStatus = "FULFILLED";
    toStatus = "DELIVERED";
    await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: "DELIVERED" } });
  } else if (input.outcome === "PARTIALLY_DELIVERED" && !alreadyFinal && current !== "PARTIALLY_DELIVERED") {
    patch.status = "PARTIALLY_DELIVERED";
    patch.partiallyDeliveredAt = new Date();
    patch.fulfillmentStatus = "PARTIALLY_FULFILLED";
    toStatus = "PARTIALLY_DELIVERED";
  } else if (input.outcome === "RETURNED" && !alreadyFinal && current !== "RETURNED") {
    const restock = await restockReturnedUnits(tx, {
      businessId: input.businessId,
      order,
      items: order.items,
      reason: "courier_return",
      note: input.note ?? `Courier reported a return (${input.shipmentReference})`,
      actorUserId: input.actorUserId ?? null,
      keyPrefix: "courier-return",
    });
    restockedUnits = restock.restockedUnits;
    patch.status = "RETURNED";
    patch.returnedAt = new Date();
    patch.fulfillmentStatus = "CANCELLED";
    toStatus = "RETURNED";

    if (order.resellerId) {
      const voided = await voidResellerEarnings(tx, {
        orderId: order.id,
        reason: `Courier reported the parcel returned (${input.shipmentReference})`,
        actorUserId: input.actorUserId ?? null,
        resellerId: order.resellerId,
      });
      earningsVoided = voided.voided > 0;
      for (const payoutId of voided.affectedPayoutIds) {
        await reconcilePayoutAfterVoid(tx, {
          payoutId,
          reason: `Order ${order.orderNumber} returned by the courier`,
          actorUserId: input.actorUserId ?? null,
        });
      }
    }
  } else if (input.outcome === "CANCELLED" && !alreadyFinal) {
    patch.fulfillmentStatus = "CANCELLED";
  }

  const changed = Object.keys(patch).length > 0;
  if (changed) await tx.order.update({ where: { id: order.id }, data: patch });

  if (toStatus || input.outcome === "CANCELLED") {
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "FULFILLMENT",
        fromStatus: current,
        toStatus: toStatus ?? current,
        note:
          input.note ??
          `Courier reported ${input.providerStatusRaw ?? input.outcome.toLowerCase()} (${input.shipmentReference})`,
        reason: input.note ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: "SYSTEM",
        toGroup: statusGroupOf((toStatus ?? current) as InternalOrderStatus),
        courierEventId: input.courierEventId ?? null,
      },
    });
  }

  // A delivered order earns — but only once, and only for what was actually kept.
  if (input.outcome === "DELIVERED" && order.resellerId && toStatus === "DELIVERED") {
    const lostUnits = order.items.reduce((total, item) => total + item.returnedQuantity + item.cancelledQuantity, 0);
    if (lostUnits === 0) {
      const earnings = await recordResellerEarnings(tx, { orderId: order.id, actorUserId: input.actorUserId ?? null });
      earningsRecorded = earnings.created > 0;
    }
    // With returned or cancelled lines the outcome is not final: the operator
    // records the partial delivery and the earning is prorated at that point.
  }

  await recordAudit(
    {
      businessId: input.businessId,
      actorType: "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      actorLabel: "Courier sync",
      action: "order.courier_outcome",
      entityType: "Order",
      entityId: order.id,
      summary: `${order.orderNumber}: courier reported ${input.providerStatusRaw ?? input.outcome}`,
      before: { status: current },
      after: {
        status: toStatus ?? current,
        fulfillmentStatus: patch.fulfillmentStatus ?? order.fulfillmentStatus,
        restockedUnits,
        earningsRecorded,
        earningsVoided,
        collectedPaisa: input.collectedPaisa ?? null,
        shipmentReference: input.shipmentReference,
      } as unknown as Prisma.InputJsonValue,
      correlationId: input.courierEventId ?? null,
    },
    tx,
  );

  return {
    orderStatusChanged: changed && toStatus !== null,
    fromStatus: current,
    toStatus,
    restockedUnits,
    earningsRecorded,
    earningsVoided,
  };
}
