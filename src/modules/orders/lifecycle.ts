import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { getBusinessSettings } from "@/lib/settings";
import { applyStockMovement, defaultLocationId } from "@/modules/inventory/service";
import { cancelOrder, dispatchOrder, transitionOrder } from "@/modules/orders/service";
import { recordResellerEarnings, reconcilePayoutAfterVoid, voidResellerEarnings } from "@/modules/resellers/earnings";
import { recordCollectionChange } from "@/modules/resellers/service";
import { recalculateCustomerStats } from "@/modules/customers/service";
import {
  evaluateStatusTransition,
  holdsPermission,
  isDeletable,
  isDispatchEligible,
  statusGroupOf,
  statusLabel,
  type InternalOrderStatus,
  type StatusSubject,
  type TransitionDecision,
} from "@/modules/orders/status";
import { orderActorFrom, orderScopeWhere, statusActorFrom, type ManualOrderContext } from "@/modules/orders/manual";
import { restockReturnedUnits } from "@/modules/orders/courier-outcome";
import type {
  BulkCourierDispatchInput,
  BulkOrderStatusInput,
  DeleteOrderInput,
  OrderStatusChangeInput,
  PartialDeliveryInput,
} from "@/modules/orders/schemas";

/**
 * Permission-aware order lifecycle: status transitions, bulk status updates,
 * courier dispatch (single and bulk), partial delivery, returns and deletion of
 * cancelled orders.
 *
 * Every entry point re-reads the order and re-evaluates the actor's *current*
 * permissions against the order's *current* status inside its own transaction, so
 * a stale screen, a bookmarked form or a hand-crafted request can never widen what
 * a user is allowed to do. Hiding a button in the UI is never authorization.
 */

export type OrderWithLifecycle = Prisma.OrderGetPayload<{ include: { items: true; shipments: true } }>;

async function loadOrder(context: ManualOrderContext, orderId: string): Promise<OrderWithLifecycle> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId: context.businessId, deletedAt: null, ...orderScopeWhere(context) },
    include: { items: true, shipments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}

/** Money and courier records that must survive even a cancelled order. */
async function protectedRecords(orderId: string) {
  const [payments, refunds, codCollections, settlementEntries, earnings, exchanges, shipmentCharges, shipments] =
    await Promise.all([
      prisma.payment.count({ where: { orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } }),
      prisma.refund.count({ where: { orderId } }),
      prisma.codCollection.count({ where: { orderId } }),
      prisma.courierSettlementEntry.count({ where: { shipment: { orderId } } }),
      prisma.resellerOrderEarning.count({ where: { orderId } }),
      prisma.exchangeRequest.count({ where: { orderId } }),
      prisma.courierCharge.count({ where: { shipment: { orderId } } }),
      prisma.shipment.count({ where: { orderId } }),
    ]);
  return { payments, refunds, codCollections, settlementEntries, earnings, exchanges, shipmentCharges, shipments };
}

/** Build the policy subject the status rules are evaluated against. */
export async function orderStatusSubject(order: {
  id: string;
  status: string;
  orderType: string;
  channel: string;
  createdByUserId: string | null;
  resellerId: string | null;
  shipments: Array<{ id: string; status: string; providerConsignmentId: string | null; trackingCode: string | null }>;
}): Promise<StatusSubject> {
  const shipment = order.shipments[0];
  const shipmentState: StatusSubject["shipmentState"] = !shipment
    ? "NONE"
    : ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"].includes(shipment.status)
      ? "FINAL"
      : shipment.providerConsignmentId || shipment.trackingCode
        ? "CREATED"
        : "REQUESTED";
  const finance = await protectedRecords(order.id);
  return {
    status: order.status as InternalOrderStatus,
    orderType: order.orderType,
    channel: order.channel,
    createdByUserId: order.createdByUserId,
    resellerId: order.resellerId,
    shipmentState,
    hasSettledFinance: finance.settlementEntries > 0 || finance.payments > 0 || finance.codCollections > 0,
  };
}

// --------------------------------------------------------------------- status

export interface StatusChangeResult {
  orderId: string;
  orderNumber: string;
  from: string;
  to: string;
  decision: TransitionDecision;
  releasedUnits?: number;
  restockedUnits?: number;
}

/** Move one order to a new status, applying the documented inventory effects. */
export async function changeOrderStatus(
  context: ManualOrderContext,
  input: OrderStatusChangeInput,
): Promise<StatusChangeResult> {
  const order = await loadOrder(context, input.orderId);
  const subject = await orderStatusSubject(order);
  const target = input.status as InternalOrderStatus;
  const decision = evaluateStatusTransition({
    actor: statusActorFrom(context),
    subject,
    target,
    confirmed: input.confirmed ?? false,
    reason: input.reason ?? null,
  });

  if (!decision.allowed) {
    // A refused-but-confirmable transition is reported as invalid state (the UI
    // shows the warning dialog); a plain refusal is a permission problem.
    throw decision.requiresConfirmation || decision.requiresReason
      ? AppError.invalidState(decision.deniedReason ?? "This change needs a confirmation and a reason")
      : AppError.forbidden(decision.deniedReason ?? "You are not allowed to change this order's status");
  }

  const actor = orderActorFrom(context);

  if (target === "CANCELLED") {
    const cancelled = await cancelOrder(actor, {
      orderId: order.id,
      reason: (input.reason ?? "").trim() || "Cancelled from the order screen",
      restock: true,
    });
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: "CANCELLED",
      decision,
      releasedUnits: cancelled.releasedUnits,
      restockedUnits: cancelled.restockedUnits,
    };
  }

  if (decision.effect === "PARTIAL_DELIVERY") {
    throw AppError.validation(
      "Record how many units were delivered and how many came back — use “Partial delivery” instead of a plain status change",
    );
  }
  if (decision.effect === "REQUIRES_DISPATCH") {
    throw AppError.validation("Use “Send to courier”: dispatching consumes the reserved stock and creates the shipment");
  }

  if (decision.effect === "RETURN_TO_STOCK") {
    await returnOrderToStock(context, order.id, input.reason ?? null);
  }

  // Reseller money is prorated to what the customer actually kept *before* the
  // transition records earnings, so a partially delivered order never pays out
  // for returned units.
  if ((target === "DELIVERED" || target === "COMPLETED") && order.resellerId) {
    await prorateResellerCollection(context, order.id);
  }

  const updated = await transitionOrder(actor, {
    orderId: order.id,
    status: target as "CONFIRMED",
    note: input.reason ?? undefined,
    reason: input.reason ?? null,
    adminOverride: decision.isAdminOverride,
    confirmationAcknowledged: decision.requiresConfirmation ? input.confirmed ?? false : false,
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    from: order.status,
    to: updated.status,
    decision,
  };
}

/**
 * Bulk status update.
 *
 * Eligible orders are applied, ineligible ones are skipped with the reason the
 * server gave. A mixed selection never blocks the orders that could be updated,
 * and the summary never claims more than actually happened.
 */
export async function bulkChangeOrderStatus(
  context: ManualOrderContext,
  input: BulkOrderStatusInput,
): Promise<{
  updated: StatusChangeResult[];
  skipped: Array<{ orderId: string; orderNumber: string | null; reason: string }>;
}> {
  const updated: StatusChangeResult[] = [];
  const skipped: Array<{ orderId: string; orderNumber: string | null; reason: string }> = [];

  for (const orderId of [...new Set(input.orderIds)]) {
    try {
      const result = await changeOrderStatus(context, {
        orderId,
        status: input.status,
        reason: input.reason,
        confirmed: input.confirmed ?? false,
      });
      updated.push(result);
    } catch (error) {
      const order = await prisma.order
        .findFirst({ where: { id: orderId, businessId: context.businessId }, select: { orderNumber: true } })
        .catch(() => null);
      skipped.push({
        orderId,
        orderNumber: order?.orderNumber ?? null,
        reason: error instanceof AppError ? error.message : "This order could not be updated",
      });
      if (!(error instanceof AppError)) logger.error("Bulk status update failed", error, { orderId });
    }
  }

  await recordAudit({
    businessId: context.businessId,
    actorType: "USER",
    actorUserId: context.userId,
    actorLabel: context.actorLabel,
    action: "order.bulk_status_changed",
    entityType: "Order",
    summary: `Bulk status change to ${statusLabel(input.status)}: ${updated.length} updated, ${skipped.length} skipped`,
    after: {
      status: input.status,
      updated: updated.map((entry) => entry.orderNumber),
      skipped,
    } as unknown as Prisma.InputJsonValue,
    reason: input.reason ?? null,
    ipAddress: context.ipAddress ?? null,
  });

  return { updated, skipped };
}

// ----------------------------------------------------------- courier dispatch

export interface DispatchSummaryEntry {
  orderId: string;
  orderNumber: string | null;
  status: "submitted" | "skipped" | "failed";
  reason?: string;
  shipmentId?: string;
  internalCode?: string;
}

/**
 * Send confirmed orders to the courier.
 *
 * Only confirmed, courier-eligible orders with a shipping address are submitted;
 * everything else is skipped with a reason. Repeated clicks cannot create a second
 * shipment: the shipment row carries the idempotency key `order:{id}:shipment`.
 */
export async function sendOrdersToCourier(
  context: ManualOrderContext,
  input: BulkCourierDispatchInput,
): Promise<{ entries: DispatchSummaryEntry[]; submitted: number; skipped: number; failed: number }> {
  const statusActor = statusActorFrom(context);
  const orderActor = orderActorFrom(context);
  const mayDispatch = holdsPermission(statusActor, "order.dispatch");
  const entries: DispatchSummaryEntry[] = [];

  for (const orderId of [...new Set(input.orderIds)]) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, businessId: context.businessId, deletedAt: null, ...orderScopeWhere(context) },
      include: {
        shipments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, providerConsignmentId: true, trackingCode: true },
        },
      },
    });
    if (!order) {
      entries.push({ orderId, orderNumber: null, status: "skipped", reason: "Order not found or not visible to you" });
      continue;
    }

    const shipment = order.shipments[0];
    const eligibility = isDispatchEligible({
      status: order.status,
      orderType: order.orderType,
      channel: order.channel,
      shipmentState: !shipment
        ? "NONE"
        : shipment.providerConsignmentId || shipment.trackingCode
          ? "CREATED"
          : "REQUESTED",
      hasShippingAddress: Boolean(order.shippingDistrictCode && order.shippingAddressLine),
    });
    if (!eligibility.eligible) {
      entries.push({ orderId, orderNumber: order.orderNumber, status: "skipped", reason: eligibility.reason });
      continue;
    }
    if (!mayDispatch) {
      entries.push({
        orderId,
        orderNumber: order.orderNumber,
        status: "skipped",
        reason: "You are not allowed to send orders to the courier",
      });
      continue;
    }

    try {
      const result = await dispatchOrder(orderActor, { orderId, courierProviderId: input.courierProviderId ?? null });
      entries.push({
        orderId,
        orderNumber: order.orderNumber,
        status: "submitted",
        shipmentId: result.shipment.id,
        internalCode: result.shipment.internalCode,
      });
    } catch (error) {
      entries.push({
        orderId,
        orderNumber: order.orderNumber,
        status: "failed",
        reason: error instanceof AppError ? error.message : "The courier request could not be queued",
      });
      if (!(error instanceof AppError)) logger.error("Courier dispatch failed", error, { orderId });
    }
  }

  const submitted = entries.filter((entry) => entry.status === "submitted").length;
  const skipped = entries.filter((entry) => entry.status === "skipped").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;

  await recordAudit({
    businessId: context.businessId,
    actorType: "USER",
    actorUserId: context.userId,
    actorLabel: context.actorLabel,
    action: "order.bulk_courier_dispatch",
    entityType: "Order",
    summary: `Send to courier: ${submitted} submitted, ${skipped} skipped, ${failed} failed`,
    after: { entries } as unknown as Prisma.InputJsonValue,
    ipAddress: context.ipAddress ?? null,
  });

  return { entries, submitted, skipped, failed };
}

// ----------------------------------------------------------- partial delivery

/**
 * Record a partial delivery: which quantities reached the customer and which came
 * back. Returned units go into stock inspection (or straight back to sellable
 * stock when the business does not require inspection), and the order never looks
 * fully delivered. Reseller money is prorated to the delivered value.
 */
export async function processPartialDelivery(
  context: ManualOrderContext,
  input: PartialDeliveryInput,
): Promise<{
  orderId: string;
  orderNumber: string;
  deliveredUnits: number;
  returnedUnits: number;
  restockedUnits: number;
}> {
  const order = await loadOrder(context, input.orderId);
  const actor = statusActorFrom(context);

  if (statusGroupOf(order.status) === "PRE_COURIER") {
    // Nothing has been handed over yet, so there is nothing to partially deliver.
    throw AppError.invalidState(
      `This order is ${statusLabel(order.status)} and has not been dispatched — confirm and send it to the courier first, or cancel the lines that will not ship`,
    );
  }
  if (
    !holdsPermission(actor, "order.status.post_courier") &&
    !holdsPermission(actor, "order.status.override")
  ) {
    throw AppError.forbidden("You are not allowed to record post-courier outcomes");
  }

  const settings = await getBusinessSettings(context.businessId);
  const inspectReturns = Boolean(settings["exchange.restock_requires_inspection"] ?? true);

  const result = await withTransaction(async (tx) => {
    const locationId = await defaultLocationId(context.businessId);
    let deliveredUnits = 0;
    let returnedUnits = 0;
    let restockedUnits = 0;

    for (const entry of input.items) {
      const item = order.items.find((candidate) => candidate.id === entry.orderItemId);
      if (!item) throw AppError.validation("One of the lines does not belong to this order");

      const settled = item.returnedQuantity + item.cancelledQuantity + item.exchangedQuantity;
      const remaining = Math.max(0, item.quantity - settled);
      const delivered = Math.max(0, Math.trunc(entry.deliveredQuantity ?? 0));
      const returned = Math.max(0, Math.trunc(entry.returnedQuantity ?? 0));
      if (delivered + returned > remaining) {
        throw AppError.validation(
          `${item.productName}: only ${remaining} unit(s) are still outstanding on this line`,
        );
      }
      if (delivered + returned === 0) continue;

      if (returned > 0 && item.variantId) {
        const key = `order:${order.id}:partial-return:${item.id}:${item.returnedQuantity + returned}`;
        await applyStockMovement(tx, {
          businessId: context.businessId,
          locationId,
          variantId: item.variantId,
          type: inspectReturns ? "INSPECTION_IN" : "SALE_REVERSAL",
          ...(inspectReturns ? { inspectionDelta: returned } : { onHandDelta: returned }),
          unitCostPaisa: item.unitCostPaisa || null,
          sourceType: "Order",
          sourceId: order.id,
          reference: order.orderNumber,
          reason: "partial_delivery_return",
          note: input.note ?? null,
          actorUserId: context.userId,
          idempotencyKey: key,
        });
        restockedUnits += returned;
      }

      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          returnedQuantity: item.returnedQuantity + returned,
          status: delivered + returned >= remaining ? "DELIVERED" : item.status,
        },
      });
      deliveredUnits += delivered;
      returnedUnits += returned;
    }

    if (deliveredUnits === 0 && returnedUnits === 0) {
      throw AppError.validation("Record at least one delivered or returned unit");
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PARTIALLY_DELIVERED",
        partiallyDeliveredAt: new Date(),
        fulfillmentStatus: "PARTIALLY_FULFILLED",
        updatedByUserId: context.userId,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "FULFILLMENT",
        fromStatus: order.status,
        toStatus: "PARTIALLY_DELIVERED",
        note: input.note ?? `${deliveredUnits} delivered, ${returnedUnits} returned`,
        reason: input.note ?? null,
        actorUserId: context.userId,
        actorType: "USER",
        actorRole: context.roleLabel,
        confirmationAcknowledged: input.confirmed ?? false,
        toGroup: statusGroupOf("PARTIALLY_DELIVERED"),
      },
    });

    await recordAudit(
      {
        businessId: context.businessId,
        actorType: "USER",
        actorUserId: context.userId,
        actorLabel: context.actorLabel,
        action: "order.partial_delivery",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber}: ${deliveredUnits} delivered, ${returnedUnits} returned`,
        before: { status: order.status },
        after: {
          status: updated.status,
          deliveredUnits,
          returnedUnits,
          restockedUnits,
          inspectReturns,
          items: input.items,
        } as unknown as Prisma.InputJsonValue,
        changedFields: ["status", "returnedQuantity"],
        reason: input.note ?? null,
        ipAddress: context.ipAddress ?? null,
      },
      tx,
    );

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      deliveredUnits,
      returnedUnits,
      restockedUnits,
    };
  });

  if (order.resellerId) {
    await prorateResellerCollection(context, order.id);
    await withTransaction((tx) => recordResellerEarnings(tx, { orderId: order.id, actorUserId: context.userId }));
  }

  return result;
}

// -------------------------------------------------------------------- returns

/**
 * Return a whole order: every dispatched unit goes back into inspection (or to
 * sellable stock), reseller earnings for the order are voided and any payout that
 * contained them is re-costed. Idempotent per line, so a repeated event never
 * restocks twice.
 */
async function returnOrderToStock(context: ManualOrderContext, orderId: string, reason: string | null) {
  const settings = await getBusinessSettings(context.businessId);
  const inspectReturns = Boolean(settings["exchange.restock_requires_inspection"] ?? true);

  await withTransaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });

    const { restockedUnits } = await restockReturnedUnits(tx, {
      businessId: context.businessId,
      order,
      items: order.items,
      reason: "order_returned",
      note: reason,
      actorUserId: context.userId,
      keyPrefix: "return",
      inspectReturns,
    });

    if (order.resellerId) {
      const voided = await voidResellerEarnings(tx, {
        orderId: order.id,
        reason: `Order returned${reason ? `: ${reason}` : ""}`,
        actorUserId: context.userId,
        resellerId: order.resellerId,
      });
      for (const payoutId of voided.affectedPayoutIds) {
        await reconcilePayoutAfterVoid(tx, {
          payoutId,
          reason: `Order ${order.orderNumber} returned`,
          actorUserId: context.userId,
        });
      }
    }

    await recordAudit(
      {
        businessId: context.businessId,
        actorType: "USER",
        actorUserId: context.userId,
        actorLabel: context.actorLabel,
        action: "order.returned",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber} returned: ${restockedUnits} unit(s) back to ${inspectReturns ? "inspection" : "sellable stock"}`,
        after: { restockedUnits, inspectReturns },
        reason,
        ipAddress: context.ipAddress ?? null,
      },
      tx,
    );
  });
}

/**
 * Adjust a reseller order's collection snapshot to the value the customer actually
 * kept, through the audited collection-change workflow. Earnings stay *pending*
 * until the COD settlement is reconciled, so this only fixes the amount the
 * settlement will later pay out.
 */
async function prorateResellerCollection(context: ManualOrderContext, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order?.resellerId) return;

  const lostUnits = order.items.reduce((total, item) => total + item.returnedQuantity + item.cancelledQuantity, 0);
  if (lostUnits === 0) return;

  const goodsValuePaisa = order.items.reduce((total, item) => {
    const kept = Math.max(0, item.quantity - item.returnedQuantity - item.cancelledQuantity);
    if (item.quantity <= 0) return total;
    return total + Math.round((item.lineTotalPaisa * kept) / item.quantity);
  }, 0);
  // Delivery and COD charges stay charged: the courier performed the delivery.
  const collectionPaisa = goodsValuePaisa + order.deliveryFeePaisa + order.codSurchargePaisa;
  if (collectionPaisa === order.resellerCollectionPaisa) return;

  await recordCollectionChange(
    { businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: context.actorLabel },
    {
      orderId,
      amountPaisa: collectionPaisa,
      reason: `Adjusted to the delivered quantity (${lostUnits} unit(s) returned or cancelled)`,
    },
  );
}

// ------------------------------------------------------------------- deletion

export interface DeletionResult {
  deleted: true;
  orderId: string;
  orderNumber: string;
  deletionRecordId: string;
  message: string;
}

/**
 * Permanently delete a cancelled order.
 *
 * Policy (docs/BUSINESS_RULES.md → "Deleting cancelled orders"):
 *   - only CANCELLED orders are eligible, and the status is re-read inside the
 *     deletion transaction;
 *   - only a user with `order.delete` may do it, inside their own order scope;
 *   - the operator must confirm the permanent-deletion dialog;
 *   - the order and its operational rows (items, adjustments, addresses, status
 *     history, released reservations, cancelled preorder commitments) are removed
 *     for real — this is a permanent deletion, not a bin;
 *   - a snapshot is written to `OrderDeletionRecord` and to the audit log *before*
 *     the row goes, so "what was ORD-123 and who removed it" stays answerable;
 *   - customers, their addresses and their other orders are never touched, and the
 *     customer's lifetime statistics are recalculated;
 *   - the inventory ledger is untouched: movements keep their order id and stay in
 *     place, so stock history remains complete and reconcilable;
 *   - deletion is *refused* while money or courier records still depend on the
 *     order (collected payments, refunds, COD collections, settlement entries,
 *     courier charges, reseller earnings, exchange requests) or while a courier
 *     shipment exists. Those records must be reconciled or reversed first —
 *     silently dropping them would break financial integrity.
 */
export async function deleteCancelledOrder(
  context: ManualOrderContext,
  input: DeleteOrderInput,
): Promise<DeletionResult> {
  const actor = statusActorFrom(context);
  if (!holdsPermission(actor, "order.delete")) {
    throw AppError.forbidden("You are not allowed to delete orders");
  }
  if (!input.confirmed) {
    throw AppError.invalidState("Confirm the permanent-deletion dialog before deleting this order");
  }

  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, businessId: context.businessId, ...orderScopeWhere(context) },
      include: { items: true, adjustments: true, addresses: true, statusHistory: true, shipments: true },
    });
    if (!order) throw AppError.notFound("Order not found");
    if (!isDeletable(order)) {
      throw AppError.invalidState(`Only cancelled orders can be deleted — this one is ${statusLabel(order.status)}`);
    }

    const finance = await protectedRecords(order.id);
    const blockers: string[] = [];
    if (finance.payments > 0) blockers.push(`${finance.payments} collected payment(s)`);
    if (finance.refunds > 0) blockers.push(`${finance.refunds} refund(s)`);
    if (finance.codCollections > 0) blockers.push("a courier COD collection");
    if (finance.settlementEntries > 0) blockers.push("a courier settlement entry");
    if (finance.shipmentCharges > 0) blockers.push("recorded courier charges");
    if (finance.earnings > 0) blockers.push("reseller earning records");
    if (finance.exchanges > 0) blockers.push("an exchange request");
    const shipment = order.shipments[0];
    if (shipment) {
      blockers.push(
        `courier shipment ${shipment.trackingCode ?? shipment.providerConsignmentId ?? shipment.internalCode} (${statusLabel(shipment.status)})`,
      );
    }
    if (blockers.length > 0) {
      throw AppError.invalidState(
        `This cancelled order still has ${blockers.join(", ")}. Reverse or reconcile those records first — they are kept so the money and the parcel stay traceable.`,
      );
    }

    const snapshot = {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        channel: order.channel,
        orderType: order.orderType,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        placedAt: order.placedAt.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        cancelReason: order.cancelReason,
        createdByUserId: order.createdByUserId,
        createdByUserRole: order.createdByUserRole,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhoneNormalized: order.customerPhoneNormalized,
        shippingDistrictCode: order.shippingDistrictCode,
        shippingAddressLine: order.shippingAddressLine,
        itemsSubtotalPaisa: order.itemsSubtotalPaisa,
        discountTotalPaisa: order.discountTotalPaisa,
        deliveryFeePaisa: order.deliveryFeePaisa,
        deliveryFeeCalculatedPaisa: order.deliveryFeeCalculatedPaisa,
        grandTotalPaisa: order.grandTotalPaisa,
        paidPaisa: order.paidPaisa,
        codCollectPaisa: order.codCollectPaisa,
      },
      items: order.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPricePaisa: item.unitPricePaisa,
        discountPaisa: item.discountPaisa,
        lineSubtotalPaisa: item.lineSubtotalPaisa,
        lineTotalPaisa: item.lineTotalPaisa,
        reservedQuantity: item.reservedQuantity,
        preorderQuantity: item.preorderQuantity,
        cancelledQuantity: item.cancelledQuantity,
      })),
      adjustments: order.adjustments.map((adjustment) => ({
        type: adjustment.type,
        label: adjustment.label,
        amountPaisa: adjustment.amountPaisa,
      })),
      addresses: order.addresses.map((address) => ({
        type: address.type,
        districtCode: address.districtCode,
        addressLine: address.addressLine,
      })),
      statusHistory: order.statusHistory.map((entry) => ({
        field: entry.field,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };

    const deletion = await tx.orderDeletionRecord.create({
      data: {
        businessId: context.businessId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        channel: order.channel,
        status: order.status,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhoneNormalized: order.customerPhoneNormalized,
        resellerId: order.resellerId,
        grandTotalPaisa: order.grandTotalPaisa,
        paidPaisa: order.paidPaisa,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        reason: input.reason ?? null,
        deletedByUserId: context.userId,
        deletedByRole: context.roleLabel,
      },
    });

    await recordAudit(
      {
        businessId: context.businessId,
        actorType: "USER",
        actorUserId: context.userId,
        actorLabel: context.actorLabel,
        action: "order.deleted",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber} permanently deleted (cancelled order)`,
        before: snapshot as unknown as Prisma.InputJsonValue,
        after: { deletionRecordId: deletion.id, customerPreserved: Boolean(order.customerId) },
        changedFields: ["deleted"],
        reason: input.reason ?? null,
        ipAddress: context.ipAddress ?? null,
      },
      tx,
    );

    // The order and its operational children go. Customer rows, addresses, the
    // inventory ledger and the audit trail stay.
    await tx.order.delete({ where: { id: order.id } });
    if (order.customerId) await recalculateCustomerStats(tx, order.customerId);

    return {
      deleted: true as const,
      orderId: order.id,
      orderNumber: order.orderNumber,
      deletionRecordId: deletion.id,
      message: `${order.orderNumber} was permanently deleted. The customer record and the stock ledger were kept, and a snapshot is stored in the deletion log.`,
    };
  });
}

export { protectedRecords as orderProtectedRecordCounts };
