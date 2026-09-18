import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { getBusinessSettings } from "@/lib/settings";
import { applyStockMovement, defaultLocationId } from "@/modules/inventory/service";
import { resolveVariantPrice } from "@/modules/pricing/service";
import type { CreateExchangeInput, InspectExchangeInput } from "@/modules/exchanges/schemas";

/**
 * Exchanges.
 *
 * v1 has no return-only flow: every exchange returns at least one item and can
 * optionally ship replacements. Money is computed from immutable snapshots —
 * the credit uses the price the customer actually paid, the charge uses the
 * current price of the replacement — and the difference is either collected
 * (customer owes) or refunded (business owes).
 */

export interface ExchangeActor {
  businessId: string;
  userId?: string | null;
  customerId?: string | null;
  actorLabel?: string | null;
  actorType?: "USER" | "CUSTOMER" | "SYSTEM" | "API_KEY";
}

type Tx = Prisma.TransactionClient;

const WINDOW_SETTING_DEFAULT_DAYS = 7;

async function exchangeWindowDays(businessId: string): Promise<number> {
  const settings = await getBusinessSettings(businessId);
  const value = Number(settings["exchange.window_days"] ?? WINDOW_SETTING_DEFAULT_DAYS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : WINDOW_SETTING_DEFAULT_DAYS;
}

/** Which quantities of each order item can still be exchanged. */
async function remainingExchangeable(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const used = await tx.exchangeItem.groupBy({
    by: ["orderItemId"],
    where: { direction: "RETURN", orderItemId: { in: items.map((item) => item.id) }, exchangeRequest: { status: { notIn: ["REJECTED", "CANCELLED"] } } },
    _sum: { quantity: true },
  });
  const usedByItem = new Map(used.map((row) => [row.orderItemId ?? "", row._sum.quantity ?? 0]));
  return items.map((item) => ({
    item,
    remaining: item.quantity - item.returnedQuantity - (usedByItem.get(item.id) ?? 0),
  }));
}

export async function createExchangeRequest(actor: ExchangeActor, input: CreateExchangeInput) {
  return withTransaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.exchangeRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { exchange: existing, reused: true as const };
    }

    const order = await tx.order.findFirst({
      where: { id: input.orderId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status !== "DELIVERED" && order.status !== "COMPLETED") {
      throw AppError.invalidState("Only delivered orders can be exchanged");
    }

    const windowDays = await exchangeWindowDays(actor.businessId);
    const deliveredAt = order.deliveredAt ?? order.updatedAt;
    const closesAt = new Date(deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
    if (new Date() > closesAt) {
      throw AppError.invalidState(`The ${windowDays}-day exchange window for this order closed on ${closesAt.toISOString().slice(0, 10)}`);
    }

    const reason = await tx.exchangeReason.findFirst({
      where: { businessId: actor.businessId, code: input.reasonCode, isActive: true },
    });
    if (!reason) throw AppError.validation("Choose an active exchange reason");
    if (reason.requiresNote && !input.reasonNote) throw AppError.validation("This reason requires a note");

    const exchangeable = await remainingExchangeable(tx, order.id);
    const byOrderItemId = new Map(exchangeable.map((row) => [row.item.id, row]));
    const settings = await getBusinessSettings(actor.businessId);
    const locationId = await defaultLocationId(actor.businessId);

    let returnValuePaisa = 0;
    const returnRows: Array<{
      orderItemId: string;
      variantId: string;
      sku: string;
      productName: string;
      variantName: string;
      attributesSnapshot: Prisma.InputJsonValue;
      quantity: number;
      unitPricePaisa: number;
      unitCostPaisa: number;
      note?: string | null;
    }> = [];

    for (const item of input.returnItems) {
      const entry = byOrderItemId.get(item.orderItemId ?? "");
      if (!entry) throw AppError.validation("One of the selected items does not belong to this order");
      if (item.quantity > entry.remaining) {
        throw AppError.validation(`${entry.item.sku}: only ${entry.remaining} unit(s) can still be exchanged`);
      }
      returnValuePaisa += entry.item.unitPricePaisa * item.quantity;
      returnRows.push({
        orderItemId: entry.item.id,
        variantId: entry.item.variantId ?? item.variantId,
        sku: entry.item.sku,
        productName: entry.item.productName,
        variantName: entry.item.variantName,
        attributesSnapshot: (entry.item.variantAttributes ?? []) as Prisma.InputJsonValue,
        quantity: item.quantity,
        unitPricePaisa: entry.item.unitPricePaisa,
        unitCostPaisa: entry.item.unitCostPaisa,
        note: item.note ?? null,
      });
    }

    let replacementValuePaisa = 0;
    const replacementRows: Array<{
      variantId: string;
      sku: string;
      productName: string;
      variantName: string;
      attributesSnapshot: Prisma.InputJsonValue;
      quantity: number;
      unitPricePaisa: number;
      unitCostPaisa: number;
      note?: string | null;
    }> = [];

    for (const item of input.replacementItems) {
      const variant = await tx.variant.findFirst({
        where: { id: item.variantId, product: { businessId: actor.businessId } },
        include: {
          product: { select: { name: true } },
          attributeValues: { include: { attribute: true, attributeValue: true } },
        },
      });
      if (!variant) throw AppError.validation("One of the replacement items is not available");
      if (variant.status !== "ACTIVE") throw AppError.invalidState(`${variant.sku} is unavailable for exchange`);

      const resolved = await resolveVariantPrice(variant.id, { quantity: item.quantity });
      if (resolved.pricePaisa <= 0) throw AppError.validation(`${variant.sku} has no price configured`);
      replacementValuePaisa += resolved.pricePaisa * item.quantity;
      replacementRows.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        variantName: variant.name,
        attributesSnapshot: variant.attributeValues.map((value) => ({
          name: value.attribute.name,
          value: value.attributeValue.value,
        })) as Prisma.InputJsonValue,
        quantity: item.quantity,
        unitPricePaisa: resolved.pricePaisa,
        unitCostPaisa: variant.costPaisa ?? 0,
        note: item.note ?? null,
      });
    }

    // Delivery is charged when replacements are shipped: the reason's own fee wins,
    // then the configured default, and staff can always override it explicitly.
    const shipsReplacement = input.replacementItems.length > 0;
    const defaultDeliveryCharge = Number(settings["exchange.default_delivery_charge_paisa"] ?? 0);
    const resolvedDeliveryCharge = shipsReplacement
      ? (input.deliveryChargePaisa ?? (reason.deliveryChargePaisa > 0 ? reason.deliveryChargePaisa : defaultDeliveryCharge))
      : (input.deliveryChargePaisa ?? 0);
    const additionalChargePaisa = input.additionalChargePaisa ?? 0;
    const discountPaisa = input.discountPaisa ?? 0;
    const differencePaisa = replacementValuePaisa + resolvedDeliveryCharge + additionalChargePaisa - returnValuePaisa - discountPaisa;

    const exchangeNumber = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "exchange" });

    const exchange = await tx.exchangeRequest.create({
      data: {
        businessId: actor.businessId,
        exchangeNumber,
        orderId: order.id,
        customerId: order.customerId ?? actor.customerId ?? null,
        resellerId: order.resellerId,
        reasonId: reason.id,
        reasonCode: reason.code,
        reasonNote: input.reasonNote ?? null,
        status: reason.requiresApproval ? "REQUESTED" : "APPROVED",
        channel: input.channel,
        isPartial: returnRows.some((row) => {
          const entry = byOrderItemId.get(row.orderItemId);
          return entry ? row.quantity < entry.item.quantity : true;
        }),
        returnValuePaisa,
        replacementValuePaisa,
        deliveryChargePaisa: resolvedDeliveryCharge,
        additionalChargePaisa,
        discountPaisa,
        differencePaisa,
        collectionStatus: differencePaisa > 0 ? "DUE" : differencePaisa < 0 ? "REFUND_DUE" : "NONE",
        internalNote: input.internalNote ?? null,
        expectedDeliveryAt: input.expectedDeliveryAt ?? null,
        createdByUserId: actor.userId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        items: {
          create: [
            ...returnRows.map((row) => ({ ...row, direction: "RETURN" as const, lineTotalPaisa: row.unitPricePaisa * row.quantity })),
            ...replacementRows.map((row) => ({ ...row, direction: "REPLACEMENT" as const, lineTotalPaisa: row.unitPricePaisa * row.quantity })),
          ],
        },
      },
      include: { items: true },
    });

    void locationId;

    await tx.exchangeStatusHistory.create({
      data: {
        exchangeRequestId: exchange.id,
        toStatus: exchange.status,
        note: `Exchange created (${differencePaisa > 0 ? "customer owes" : differencePaisa < 0 ? "refund due" : "even"})`,
        actorUserId: actor.userId ?? null,
        actorCustomerId: actor.customerId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });

    // An exchange that needs no approval is approved the moment it is created, so the
    // replacement units are reserved right away.
    if (exchange.status === "APPROVED") {
      await reserveReplacementStock(tx, actor, exchange.id);
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorCustomerId: actor.customerId ?? null,
        action: "exchange.created",
        entityType: "ExchangeRequest",
        entityId: exchange.id,
        summary: `Exchange ${exchangeNumber} for ${order.orderNumber} (${formatPaisa(differencePaisa)} difference)`,
        after: { returnValuePaisa, replacementValuePaisa, differencePaisa, reason: reason.code },
        changedFields: ["exchange"],
      },
      tx,
    );

    return { exchange, reused: false as const };
  });
}

/**
 * Transactional wrapper around the guarded status change, for actions that only
 * move an exchange between states (reject, receive).
 */
export async function moveExchangeStatus(
  actor: ExchangeActor,
  input: { exchangeId: string; from: string[]; to: "APPROVED" | "REJECTED" | "IN_TRANSIT" | "RECEIVED" | "INSPECTED" | "COMPLETED" | "CANCELLED"; note?: string | null },
) {
  return withTransaction((tx) => moveExchangeTo(tx, actor, input));
}

/** Guarded status change with history (exported so actions can make simple moves). */
export async function moveExchangeTo(
  tx: Tx,
  actor: ExchangeActor,
  input: { exchangeId: string; from: string[]; to: "APPROVED" | "REJECTED" | "IN_TRANSIT" | "RECEIVED" | "INSPECTED" | "COMPLETED" | "CANCELLED"; note?: string | null },
) {
  const exchange = await tx.exchangeRequest.findFirst({ where: { id: input.exchangeId, businessId: actor.businessId } });
  if (!exchange) throw AppError.notFound("Exchange not found");
  if (!input.from.includes(exchange.status)) {
    throw AppError.invalidState(`An exchange in ${exchange.status.toLowerCase()} status cannot move to ${input.to.toLowerCase()}`);
  }

  const timestamps: Record<string, Record<string, Date | string | null>> = {
    APPROVED: { approvedAt: new Date(), approvedByUserId: actor.userId ?? null },
    REJECTED: { rejectedAt: new Date(), rejectedByUserId: actor.userId ?? null },
    RECEIVED: { receivedAt: new Date(), receivedByUserId: actor.userId ?? null },
    INSPECTED: { inspectedAt: new Date(), inspectedByUserId: actor.userId ?? null },
    COMPLETED: { completedAt: new Date() },
    CANCELLED: { cancelledAt: new Date() },
  };

  const updated = await tx.exchangeRequest.update({
    where: { id: exchange.id },
    data: {
      status: input.to,
      updatedByUserId: actor.userId ?? null,
      ...(timestamps[input.to] ?? {}),
      ...(input.to === "REJECTED" ? { rejectionReason: input.note ?? null } : {}),
      ...(input.to === "CANCELLED" ? { cancelReason: input.note ?? null } : {}),
    },
  });

  await tx.exchangeStatusHistory.create({
    data: {
      exchangeRequestId: exchange.id,
      fromStatus: exchange.status,
      toStatus: input.to,
      note: input.note ?? null,
      actorUserId: actor.userId ?? null,
      actorCustomerId: actor.customerId ?? null,
      actorType: actor.actorType ?? "USER",
    },
  });

  return updated;
}

/**
 * Reserve the replacement units an approved exchange promises to ship.
 *
 * Runs inside the caller's transaction and is idempotent per exchange item, so an
 * exchange created already-approved and an exchange approved later reserve once.
 */
export async function reserveReplacementStock(tx: Tx, actor: ExchangeActor, exchangeId: string): Promise<number> {
  const items = await tx.exchangeItem.findMany({ where: { exchangeRequestId: exchangeId, direction: "REPLACEMENT" } });
  const locationId = await defaultLocationId(actor.businessId);
  let reserved = 0;

  for (const item of items) {
    if (!item.variantId || item.replacementStatus === "RESERVED" || item.replacementStatus === "DISPATCHED") continue;
    await applyStockMovement(tx, {
      businessId: actor.businessId,
      locationId,
      variantId: item.variantId,
      type: "RESERVATION",
      reservedDelta: item.quantity,
      sourceType: "ExchangeRequest",
      sourceId: exchangeId,
      reference: null,
      reason: "exchange_replacement_reserved",
      actorUserId: actor.userId ?? null,
      idempotencyKey: `exchange:${exchangeId}:reserve:${item.id}`,
    });
    await tx.exchangeItem.update({ where: { id: item.id }, data: { replacementStatus: "RESERVED" } });
    reserved += item.quantity;
  }

  return reserved;
}

export async function approveExchange(actor: ExchangeActor, input: { exchangeId: string; note?: string | null }) {
  return withTransaction(async (tx) => {
    const exchange = await moveExchangeTo(tx, actor, { exchangeId: input.exchangeId, from: ["REQUESTED"], to: "APPROVED", note: input.note });

    // Reserve replacement stock so an approved exchange cannot be sold away.
    const reservedUnits = await reserveReplacementStock(tx, actor, exchange.id);

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "exchange.approved",
        entityType: "ExchangeRequest",
        entityId: exchange.id,
        summary: `Approved exchange ${exchange.exchangeNumber}`,
        after: { status: "APPROVED", reservationUnits: reservedUnits },
      },
      tx,
    );

    return exchange;
  });
}

/** Batch inspection: sellable units return to stock, damaged/discarded units do not. */
export async function inspectExchange(actor: ExchangeActor, input: InspectExchangeInput) {
  return withTransaction(async (tx) => {
    const exchange = await tx.exchangeRequest.findFirst({
      where: { id: input.exchangeId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!exchange) throw AppError.notFound("Exchange not found");
    if (exchange.status !== "RECEIVED" && exchange.status !== "INSPECTED") {
      throw AppError.invalidState("Receive the returned items before inspecting them");
    }

    const locationId = await defaultLocationId(actor.businessId);
    // A return that comes with a replacement is an exchange of that unit; a return on
    // its own is not, and the counters have to stay apart for reporting.
    const replacesUnits = exchange.items.some((item) => item.direction === "REPLACEMENT");
    let restocked = 0;
    let damaged = 0;

    for (const decision of input.items) {
      const item = exchange.items.find((entry) => entry.id === decision.itemId);
      if (!item) throw AppError.validation("One of the inspected items does not belong to this exchange");
      if (item.direction !== "RETURN") throw AppError.validation("Only returned items can be inspected");

      const quantity = decision.quantity ?? item.quantity;
      if (quantity > item.quantity) throw AppError.validation("The inspected quantity exceeds the returned quantity");

      await tx.exchangeItem.update({
        where: { id: item.id },
        data: {
          inspectionOutcome: decision.outcome,
          inspectionNote: decision.note ?? null,
          inspectionQuantity: quantity,
          inspectedByUserId: actor.userId ?? null,
          inspectedAt: new Date(),
        },
      });

      if (!item.variantId) continue;

      if (decision.outcome === "SELLABLE") {
        const movement = await applyStockMovement(tx, {
          businessId: actor.businessId,
          locationId,
          variantId: item.variantId,
          type: "EXCHANGE_RETURN_IN",
          onHandDelta: quantity,
          unitCostPaisa: item.unitCostPaisa || null,
          sourceType: "ExchangeRequest",
          sourceId: exchange.id,
          reference: exchange.exchangeNumber,
          reason: "exchange_inspection_sellable",
          actorUserId: actor.userId ?? null,
          idempotencyKey: `exchange:${exchange.id}:restock:${item.id}`,
        });
        await tx.exchangeItem.update({ where: { id: item.id }, data: { restockMovementId: movement.movementId } });
        restocked += quantity;
      } else if (decision.outcome === "DAMAGED") {
        await applyStockMovement(tx, {
          businessId: actor.businessId,
          locationId,
          variantId: item.variantId,
          type: "DAMAGE_RECORDED",
          damagedDelta: quantity,
          unitCostPaisa: item.unitCostPaisa || null,
          sourceType: "ExchangeRequest",
          sourceId: exchange.id,
          reference: exchange.exchangeNumber,
          reason: "exchange_inspection_damaged",
          note: decision.note ?? null,
          actorUserId: actor.userId ?? null,
          idempotencyKey: `exchange:${exchange.id}:damage:${item.id}`,
        });
        damaged += quantity;
      }

      if (item.orderItemId) {
        await tx.orderItem.update({
          where: { id: item.orderItemId },
          data: {
            returnedQuantity: { increment: quantity },
            ...(replacesUnits ? { exchangedQuantity: { increment: quantity } } : {}),
            status: "EXCHANGED",
          },
        });
      }
    }

    const pending = await tx.exchangeItem.count({ where: { exchangeRequestId: exchange.id, direction: "RETURN", inspectionOutcome: "PENDING" } });
    if (pending === 0) {
      await moveExchangeTo(tx, actor, { exchangeId: exchange.id, from: ["RECEIVED"], to: "INSPECTED", note: `Inspection complete (${restocked} restocked, ${damaged} damaged)` });
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "exchange.inspected",
        entityType: "ExchangeRequest",
        entityId: exchange.id,
        summary: `Inspected ${exchange.exchangeNumber}: ${restocked} sellable, ${damaged} damaged`,
        after: { restocked, damaged, decisions: input.items.length },
        changedFields: ["exchange", "inventory"],
      },
      tx,
    );

    return { exchangeId: exchange.id, restocked, damaged, pendingItems: pending };
  });
}

/**
 * Ship the replacements: consume the reservations taken at approval and, when the
 * customer owes money, record it as a collectable amount on the order.
 */
export async function completeExchange(actor: ExchangeActor, input: { exchangeId: string; note?: string | null }) {
  return withTransaction(async (tx) => {
    const exchange = await tx.exchangeRequest.findFirst({
      where: { id: input.exchangeId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!exchange) throw AppError.notFound("Exchange not found");
    if (exchange.status !== "INSPECTED" && exchange.status !== "RECEIVED") {
      throw AppError.invalidState("Inspect the returned items before completing the exchange");
    }

    const locationId = await defaultLocationId(actor.businessId);
    const replacements = exchange.items.filter((item) => item.direction === "REPLACEMENT" && item.variantId);
    let consumed = 0;

    for (const item of replacements) {
      const reservation = await tx.inventoryMovement.findUnique({
        where: { idempotencyKey: `exchange:${exchange.id}:reserve:${item.id}` },
      });
      void reservation;
      await applyStockMovement(tx, {
        businessId: actor.businessId,
        locationId,
        variantId: item.variantId!,
        type: "EXCHANGE_REPLACEMENT_OUT",
        onHandDelta: -item.quantity,
        reservedDelta: -item.quantity,
        unitCostPaisa: item.unitCostPaisa || null,
        sourceType: "ExchangeRequest",
        sourceId: exchange.id,
        reference: exchange.exchangeNumber,
        reason: "exchange_replacement_dispatched",
        actorUserId: actor.userId ?? null,
        idempotencyKey: `exchange:${exchange.id}:replacement-out:${item.id}`,
        allowNegativeAvailable: true,
      });
      await tx.exchangeItem.update({ where: { id: item.id }, data: { replacementStatus: "DISPATCHED" } });
      consumed += item.quantity;
    }

    // Money: positive difference is collected, negative becomes a refund.
    let refundId: string | null = exchange.refundId;
    let collectionStatus = exchange.collectionStatus;
    if (exchange.differencePaisa > 0) {
      collectionStatus = "DUE";
    } else if (exchange.differencePaisa < 0) {
      const existing = exchange.refundId
        ? await tx.refund.findUnique({ where: { id: exchange.refundId } })
        : null;
      if (!existing && exchange.orderId) {
        const refund = await tx.refund.create({
          data: {
            businessId: actor.businessId,
            orderId: exchange.orderId,
            exchangeRequestId: exchange.id,
            method: "MANUAL",
            status: "REQUESTED",
            amountPaisa: Math.abs(exchange.differencePaisa),
            reason: "exchange_difference",
            note: `Exchange ${exchange.exchangeNumber} owes the customer ${formatPaisa(Math.abs(exchange.differencePaisa))}`,
            requestedByUserId: actor.userId ?? null,
          },
        });
        refundId = refund.id;
      }
      collectionStatus = "REFUND_DUE";
    } else {
      collectionStatus = "NONE";
    }

    const updated = await moveExchangeTo(tx, actor, { exchangeId: exchange.id, from: [exchange.status], to: "COMPLETED", note: input.note ?? null });
    const completed = await tx.exchangeRequest.update({
      where: { id: updated.id },
      data: { refundId, collectionStatus },
      include: { items: true },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "exchange.completed",
        entityType: "ExchangeRequest",
        entityId: exchange.id,
        summary: `Completed exchange ${exchange.exchangeNumber} (${formatPaisa(exchange.differencePaisa)} difference)`,
        after: { differencePaisa: exchange.differencePaisa, replacementUnits: consumed, refundId, collectionStatus },
        changedFields: ["exchange", "inventory", "payment"],
      },
      tx,
    );

    return completed;
  });
}

/** Cancel an exchange and release anything it reserved. */
export async function cancelExchange(actor: ExchangeActor, input: { exchangeId: string; reason: string }) {
  return withTransaction(async (tx) => {
    const exchange = await tx.exchangeRequest.findFirst({
      where: { id: input.exchangeId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!exchange) throw AppError.notFound("Exchange not found");
    if (exchange.status === "COMPLETED") throw AppError.invalidState("A completed exchange cannot be cancelled");

    const locationId = await defaultLocationId(actor.businessId);
    let released = 0;
    for (const item of exchange.items.filter((entry) => entry.direction === "REPLACEMENT" && entry.variantId)) {
      if (exchange.status !== "APPROVED" && exchange.status !== "IN_TRANSIT" && exchange.status !== "RECEIVED" && exchange.status !== "INSPECTED") continue;
      const existing = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: `exchange:${exchange.id}:release:${item.id}` } });
      if (existing) continue;
      await applyStockMovement(tx, {
        businessId: actor.businessId,
        locationId,
        variantId: item.variantId!,
        type: "RESERVATION_RELEASE",
        reservedDelta: -item.quantity,
        sourceType: "ExchangeRequest",
        sourceId: exchange.id,
        reference: exchange.exchangeNumber,
        reason: "exchange_cancelled",
        note: input.reason,
        actorUserId: actor.userId ?? null,
        idempotencyKey: `exchange:${exchange.id}:release:${item.id}`,
      });
      await tx.exchangeItem.update({ where: { id: item.id }, data: { replacementStatus: "RELEASED" } });
      released += item.quantity;
    }

    const cancelled = await moveExchangeTo(tx, actor, {
      exchangeId: exchange.id,
      from: ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED", "INSPECTED"],
      to: "CANCELLED",
      note: input.reason,
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "exchange.cancelled",
        entityType: "ExchangeRequest",
        entityId: exchange.id,
        summary: `Cancelled exchange ${exchange.exchangeNumber}: ${input.reason}`,
        after: { releasedUnits: released },
        reason: input.reason,
      },
      tx,
    );

    return { exchange: cancelled, releasedUnits: released };
  });
}

/** Exchanges that can still be requested for an order (used by the UI and the API). */
export async function listExchangeableItems(businessId: string, orderId: string) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId } });
    if (!order) throw AppError.notFound("Order not found");
    return remainingExchangeable(tx, orderId);
  });
}

/** Mark the collection of an exchange difference as paid. */
export async function recordExchangeCollection(
  actor: ExchangeActor,
  input: { exchangeId: string; method: "CASH" | "BKASH" | "SSLCOMMERZ" | "BANK_TRANSFER" | "MANUAL"; amountPaisa?: number; reference?: string | null },
) {
  return withTransaction(async (tx) => {
    const exchange = await tx.exchangeRequest.findFirst({ where: { id: input.exchangeId, businessId: actor.businessId } });
    if (!exchange) throw AppError.notFound("Exchange not found");
    if (exchange.differencePaisa <= 0) throw AppError.validation("This exchange does not require a collection");

    const amountPaisa = input.amountPaisa ?? exchange.differencePaisa;
    const payment = await tx.payment.create({
      data: {
        businessId: actor.businessId,
        orderId: exchange.orderId,
        method: input.method,
        status: "PAID",
        amountPaisa,
        paidPaisa: amountPaisa,
        providerName: input.method,
        providerReference: input.reference ?? null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        recordedByUserId: actor.userId ?? null,
        note: `Exchange ${exchange.exchangeNumber} difference`,
      },
    });

    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, orderId: exchange.orderId, exchangeRequestId: exchange.id, amountPaisa, direction: "COLLECT" },
    });

    await tx.exchangeRequest.update({
      where: { id: exchange.id },
      data: { paymentId: payment.id, collectionStatus: "COLLECTED" },
    });

    return payment;
  });
}

export async function getExchange(businessId: string, exchangeId: string) {
  const exchange = await prisma.exchangeRequest.findFirst({
    where: { id: exchangeId, businessId },
    include: {
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      order: { select: { orderNumber: true, id: true, customerName: true, customerPhone: true, grandTotalPaisa: true } },
      refunds: true,
      reason: true,
    },
  });
  if (!exchange) throw AppError.notFound("Exchange not found");
  return exchange;
}
